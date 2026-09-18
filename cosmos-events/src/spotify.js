'use strict';
// Spotify Web API (Client-Credentials-Flow) – nur serverseitig, Secret verlässt nie den Server.
const config = require('./config');

let token = null; // { value, expiresAt }

async function getToken() {
  if (!config.spotify) throw Object.assign(new Error('Spotify ist nicht konfiguriert'), { code: 'spotify_not_configured' });
  if (token && token.expiresAt > Date.now() + 30_000) return token.value;
  const basic = Buffer.from(`${config.spotify.clientId}:${config.spotify.clientSecret}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Spotify-Token fehlgeschlagen (${res.status})`);
  const json = await res.json();
  token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return token.value;
}

function mapTrack(t) {
  return {
    spotify_id: t.id,
    title: t.name,
    artist: (t.artists || []).map((a) => a.name).join(', '),
    album: t.album ? t.album.name : null,
    image_url: t.album && t.album.images && t.album.images.length ? t.album.images[t.album.images.length - 1].url : null,
    preview_url: t.preview_url || null,
    duration_ms: t.duration_ms || null,
    url: t.external_urls ? t.external_urls.spotify : null,
  };
}

async function searchTracks(q, limit = 10) {
  const tk = await getToken();
  const url = `https://api.spotify.com/v1/search?type=track&limit=${limit}&market=DE&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${tk}` } });
  if (!res.ok) throw new Error(`Spotify-Suche fehlgeschlagen (${res.status})`);
  const json = await res.json();
  return (json.tracks?.items || []).map(mapTrack);
}

async function getTrack(id) {
  const tk = await getToken();
  const res = await fetch(`https://api.spotify.com/v1/tracks/${encodeURIComponent(id)}?market=DE`, { headers: { Authorization: `Bearer ${tk}` } });
  if (!res.ok) throw new Error(`Spotify-Track nicht gefunden (${res.status})`);
  return mapTrack(await res.json());
}

// Erkennt Spotify-Links/URIs: https://open.spotify.com/track/<id>, spotify:track:<id>
function parseTrackId(input) {
  const s = String(input || '').trim();
  const m = s.match(/(?:open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/|spotify:track:)([A-Za-z0-9]{22})/);
  return m ? m[1] : (/^[A-Za-z0-9]{22}$/.test(s) ? s : null);
}

module.exports = { searchTracks, getTrack, parseTrackId, isConfigured: () => !!config.spotify };
