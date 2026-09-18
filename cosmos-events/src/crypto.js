'use strict';
// Kryptografische Grundfunktionen: Passwort-Hashing (scrypt), AES-256-GCM,
// TOTP (RFC 6238) und Zufallstoken. Bewusst ohne native Abhängigkeiten.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');

// ---------- Passwörter ----------
const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  try {
    const [alg, N, r, p, saltB64, hashB64] = String(stored || '').split('$');
    if (alg !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Dummy-Hash, damit Login-Versuche für unbekannte Nutzer gleich lange dauern.
const DUMMY_HASH = hashPassword('dummy-password-for-timing');

function passwordPolicy(password) {
  const p = String(password || '');
  if (p.length < 12) return 'Das Passwort muss mindestens 12 Zeichen lang sein.';
  if (p.length > 200) return 'Das Passwort ist zu lang.';
  if (!/[a-zäöü]/.test(p) || !/[A-ZÄÖÜ]/.test(p) || !/[0-9]/.test(p)) {
    return 'Das Passwort muss Groß- und Kleinbuchstaben sowie eine Ziffer enthalten.';
  }
  return null;
}

// ---------- Token ----------
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}
function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}
function randomPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out + 'A1';
}

// ---------- Datenverschlüsselung (AES-256-GCM) ----------
let dataKey = null;
function getDataKey() {
  if (dataKey) return dataKey;
  if (config.dataKeyHex) {
    if (!/^[0-9a-fA-F]{64}$/.test(config.dataKeyHex)) {
      throw new Error('DATA_ENCRYPTION_KEY muss 64 Hex-Zeichen (32 Byte) lang sein.');
    }
    dataKey = Buffer.from(config.dataKeyHex, 'hex');
    return dataKey;
  }
  fs.mkdirSync(config.keyDir, { recursive: true, mode: 0o700 });
  const keyFile = path.join(config.keyDir, 'data.key');
  if (fs.existsSync(keyFile)) {
    dataKey = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex');
  } else {
    dataKey = crypto.randomBytes(32);
    fs.writeFileSync(keyFile, dataKey.toString('hex') + '\n', { mode: 0o600 });
    if (!config.isTest) {
      console.warn(`[crypto] Neuer Datenschlüssel erzeugt: ${keyFile}. Sicher aufbewahren – ohne ihn sind Dokumente und Backups nicht lesbar.`);
    }
  }
  return dataKey;
}

const MAGIC = Buffer.from('CEV1');

function encryptBuffer(plain, aad = '') {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getDataKey(), iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, enc, cipher.getAuthTag()]);
}

function decryptBuffer(blob, aad = '') {
  if (blob.length < 4 + 12 + 16 || !blob.subarray(0, 4).equals(MAGIC)) {
    throw new Error('Ungültiges verschlüsseltes Format');
  }
  const iv = blob.subarray(4, 16);
  const tag = blob.subarray(blob.length - 16);
  const data = blob.subarray(16, blob.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getDataKey(), iv);
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

function encryptString(str) {
  return encryptBuffer(Buffer.from(String(str), 'utf8')).toString('base64');
}
function decryptString(b64) {
  return decryptBuffer(Buffer.from(b64, 'base64')).toString('utf8');
}

// Streaming-Variante für große Dateien (Backups). Format wie oben.
function encryptFile(srcPath, destPath) {
  return new Promise((resolve, reject) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getDataKey(), iv);
    const out = fs.createWriteStream(destPath, { mode: 0o600 });
    out.write(MAGIC);
    out.write(iv);
    const inp = fs.createReadStream(srcPath);
    inp.on('error', reject);
    out.on('error', reject);
    cipher.on('error', reject);
    cipher.on('end', () => {
      out.end(cipher.getAuthTag(), () => resolve(destPath));
    });
    inp.pipe(cipher).pipe(out, { end: false });
  });
}

async function decryptFile(srcPath, destPath) {
  const size = fs.statSync(srcPath).size;
  const fd = fs.openSync(srcPath, 'r');
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    if (!head.subarray(0, 4).equals(MAGIC)) throw new Error('Ungültiges Backup-Format');
    const iv = head.subarray(4, 16);
    const tag = Buffer.alloc(16);
    fs.readSync(fd, tag, 0, 16, size - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', getDataKey(), iv);
    decipher.setAuthTag(tag);
    await new Promise((resolve, reject) => {
      const inp = fs.createReadStream(srcPath, { start: 16, end: size - 17 });
      const out = fs.createWriteStream(destPath, { mode: 0o600 });
      inp.on('error', reject); out.on('error', reject); decipher.on('error', reject);
      out.on('finish', resolve);
      inp.pipe(decipher).pipe(out);
    });
  } finally {
    fs.closeSync(fd);
  }
  return destPath;
}

// ---------- TOTP (RFC 6238, SHA-1, 6 Ziffern, 30 s) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const c of clean) {
    value = (value << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}
function hotp(secretB32, counter) {
  const key = base32Decode(secretB32);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = h[h.length - 1] & 0xf;
  const code = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(code % 1_000_000).padStart(6, '0');
}
function totpCode(secretB32, time = Date.now()) {
  return hotp(secretB32, Math.floor(time / 1000 / 30));
}
function verifyTotp(secretB32, code, window = 1, time = Date.now()) {
  const c = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  const counter = Math.floor(time / 1000 / 30);
  for (let i = -window; i <= window; i++) {
    const expected = hotp(secretB32, counter + i);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return true;
  }
  return false;
}
function totpUri(secretB32, account, issuer = 'Cosmos Events') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
function generateRecoveryCodes(n = 8) {
  return Array.from({ length: n }, () => {
    const raw = crypto.randomBytes(5).toString('hex');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

module.exports = {
  hashPassword, verifyPassword, passwordPolicy, DUMMY_HASH,
  randomToken, sha256, randomPassword,
  getDataKey, encryptBuffer, decryptBuffer, encryptString, decryptString, encryptFile, decryptFile,
  generateTotpSecret, totpCode, verifyTotp, totpUri, generateRecoveryCodes,
};
