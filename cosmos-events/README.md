# Cosmos Events – Member-Dashboard

Webbasiertes Dashboard für **Cosmos Events** mit drei Rollen: **Admin**, **DJ** und **Kunde / Brautpaar**.
Kunden werden Schritt für Schritt durch die Eventplanung geführt, DJs sehen ihre Events und Gagen,
der Admin behält alles im Blick.

## Funktionsumfang (Abgleich mit den Anforderungen)

| # | Anforderung | Umsetzung |
|---|-------------|-----------|
| 1 | Memberbereich mit Rollen und Rechten | Eigene Logins je Rolle. Admin sieht alles, DJs nur zugewiesene Events, Kunden nur das eigene Event. Durchsetzung serverseitig in jeder API-Route (`requireRole`, `requireEventAccess`). |
| 2 | Event- und Kundendaten | Zentrale Speicherung von Kunden-/DJ-Stammdaten, Eventdaten, Location, zuständigem DJ, Vertragsnummer/-datum, Notizen und Dokumenten. |
| 3 | Interaktiver Fragebogen | Mehrstufiger Fragebogen mit Autosave, Fortsetzen an der letzten Stelle, Pflichtfeld-Validierung, bedingten Fragen und Abgabe. Schema ist als JSON austauschbar (`config/README.md`) – der finale Fragebogen kann ohne Codeänderung eingespielt werden. |
| 4 | Fortschrittsanzeige | 0–100 % aus gewichteten Meilensteinen: Fragebogen (35 %), Musikplanung (20 %), Update-Gespräch (15 %), finale Besprechung (20 %), Event abgeschlossen (10 %). Fortschrittsring + Meilensteinleiste + Handlungsempfehlungen. |
| 5 | Termin- und Ablaufplanung | Update-Gespräch und finale Besprechung werden bei jedem Event automatisch angelegt; Empfehlung/Hinweis für die finale Besprechung ab ca. 80 %. Timeline mit Terminen, Aufgaben und Eventtag; Kalenderansicht. |
| 6 | Spotify-Integration | Songsuche über die Spotify Web API (Client-Credentials, serverseitig) inkl. Cover, Vorschau und Spotify-Links; Kategorien Musikwünsche, Must-Plays, No-Gos und Programmpunkte (Einzug, Eröffnungstanz, …). Ohne Spotify-Zugang: manuelle Eingabe. Export als Textliste für den DJ. |
| 7 | Dokumenten-Upload | Kunden und DJs laden Ablaufpläne, Tagesbeschreibungen, Location-Bilder, Aufbaupläne etc. hoch. Typ- und Inhaltsprüfung, 20 MB Limit, verschlüsselte Ablage, DJ-interne Dokumente möglich. |
| 8 | DJ-Dashboard | Alle eigenen Events als Liste (Datum, Kunde, Location, Status, Planungsstand) und als Monatskalender, plus Detailansicht je Event. |
| 9 | Umsatz- und Gagenübersicht | Je Event: Buchungswert, Cosmos-Provision (%), Leihgebühren, resultierende DJ-Gage, ausgezahlt/offen. Kennzahlen: Anzahl Events, Gesamtumsatz, Gage gesamt, offene und ausgezahlte Beträge, Jahresfilter. Admin erfasst Auszahlungen. |
| 10 | Sicherheit und Datenschutz | Siehe Abschnitt „Sicherheitskonzept“. |

## Schnellstart (lokal)

```bash
cd cosmos-events
npm install
cp .env.example .env          # optional anpassen
npm run seed                  # Demo-Daten (Admin, 2 DJs, 3 Kunden, 4 Events)
npm run dev                   # http://localhost:3000
```

Demo-Zugänge (Passwort jeweils `CosmosDemo2026!`):

| Rolle | E-Mail |
|-------|--------|
| Admin | admin@cosmos-events.de |
| DJ | dj.nova@cosmos-events.de, dj.orbit@cosmos-events.de |
| Kunde | lena.max@example.com, sara.tom@example.com, firma.mueller@example.com |

Ohne Seed legt der Server beim ersten Start automatisch einen Admin an (`ADMIN_EMAIL`, Passwort
aus `ADMIN_PASSWORD` oder zufällig erzeugt und einmalig im Log ausgegeben).
Für Admins und DJs ist die Zwei-Faktor-Authentifizierung standardmäßig verpflichtend
(`REQUIRE_2FA_ROLES`); beim ersten Login wird die Einrichtung erzwungen.

Tests: `npm test` (Integrationstests für Auth, 2FA, Rollen, Fragebogen, Fortschritt, Musik, Upload, Termine, Finanzen, DSGVO-Funktionen, Backups).

## Produktion

### Variante A: Docker Compose mit automatischem TLS (empfohlen)

```bash
cd cosmos-events
cp .env.example .env
# .env: APP_ORIGIN=https://dashboard.deine-domain.de, DATA_ENCRYPTION_KEY=$(openssl rand -hex 32), ADMIN_EMAIL, Spotify
echo "DOMAIN=dashboard.deine-domain.de" >> .env
docker compose up -d --build
```

Caddy holt automatisch ein Let's-Encrypt-Zertifikat, erzwingt HTTPS und leitet an die App weiter.
Daten liegen im Volume `cosmos-data` (Datenbank, verschlüsselte Uploads, Backups, Schlüssel).

### Variante B: Fly.io über GitHub Actions (ohne eigenen Server)

`fly.toml` und `.github/workflows/deploy-fly.yml` liegen bei. Einmalig ein Fly.io-Konto anlegen, ein Token
als GitHub-Secret `FLY_API_TOKEN` hinterlegen und den Workflow „Deploy to Fly.io“ starten. Die App läuft
danach in Frankfurt unter `https://<app-name>.fly.dev` mit persistentem Volume; eine eigene Domain lässt sich
per `fly certs add dashboard.cosmos-events.de` anbinden. Hinweis: Reine Static-Hoster wie Netlify oder
GitHub Pages eignen sich nicht, da die App einen dauerhaft laufenden Server mit Datenbank und Dateispeicher braucht.

### Variante C: Node direkt hinter nginx/Traefik

`NODE_ENV=production TRUST_PROXY=1 APP_ORIGIN=https://… npm start` – der Proxy terminiert TLS.
Alternativ `TLS_CERT_FILE`/`TLS_KEY_FILE` setzen, dann spricht der Node-Server selbst HTTPS.

### Spotify

App unter https://developer.spotify.com/dashboard anlegen und `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`
in `.env` eintragen. Die Suche läuft ausschließlich serverseitig; das Secret verlässt den Server nie.

### Backups

- Täglich automatisch (Uhrzeit `BACKUP_HOUR`), AES-256-GCM-verschlüsselt, Aufbewahrung `BACKUP_RETENTION_DAYS`.
- Manuell: `npm run backup` oder im Admin-Bereich „Sicherheit & Backups“.
- Wiederherstellen: `npm run restore -- cosmos-2026-…sqlite.enc wiederhergestellt.sqlite`, Server stoppen,
  Datei nach `data/cosmos.sqlite` kopieren, Server starten.
- **Wichtig:** Den Datenschlüssel (`DATA_ENCRYPTION_KEY` bzw. `data/keys/data.key`) getrennt sichern –
  ohne ihn sind Backups, Dokumente und 2FA-Secrets nicht lesbar. Das Backup-Verzeichnis sollte zusätzlich
  extern gesichert werden (z. B. per rsync/rclone auf ein Off-Site-Ziel).

## Sicherheitskonzept

| Anforderung | Maßnahme |
|-------------|----------|
| Verschlüsselte Übertragung | HTTPS (Caddy/Reverse-Proxy oder direkt), HSTS mit Preload, `Secure`-Cookies, `upgrade-insecure-requests`. |
| Sichere Passwortspeicherung | scrypt (N=2¹⁵, r=8, p=1, 16-Byte-Salt), zeitkonstanter Vergleich, Dummy-Hash gegen Timing-Angriffe, Passwortrichtlinie (≥ 12 Zeichen, Groß/Klein/Ziffer), erzwungener Wechsel von Initialpasswörtern. |
| Zwei-Faktor-Authentifizierung | TOTP (RFC 6238) mit QR-Code für jede Authenticator-App, 8 einmalige Wiederherstellungscodes (gehasht), Pflicht für Admin/DJ konfigurierbar, TOTP-Secrets verschlüsselt gespeichert. |
| Rollenbasierte Zugriffsrechte | Jede Route prüft Rolle und Event-Zugehörigkeit serverseitig; Kunden sehen keine Finanz-/Interna, DJs nur zugewiesene Events; feldgenaue Schreibrechte (z. B. Kunde darf nur Gästezahl/Notiz ändern). |
| Schutz vor gängigen Angriffen | Helmet-Header inkl. strikter CSP (kein Inline-JS), `frame-ancestors 'none'` (Clickjacking), `SameSite=Strict`-Cookies + Origin-Prüfung (CSRF), Prepared Statements (SQL-Injection), HTML-Escaping im Frontend (XSS), Rate-Limits für Login/2FA/API, Kontosperre nach 8 Fehlversuchen, Session-Rotation nach 2FA, `HttpOnly`-Session-Cookies mit serverseitig gehashten Tokens, Upload-Whitelist mit Magic-Byte-Prüfung, keine Stacktraces nach außen. |
| Sichere Speicherung sensibler Daten | Dokumente, Backups und TOTP-Secrets mit AES-256-GCM verschlüsselt; Dateien unter Zufallsnamen außerhalb des Web-Roots, Auslieferung nur nach Berechtigungsprüfung; Datenverzeichnis mit 0700/0600-Rechten. |
| Regelmäßige Backups | Automatische, verschlüsselte SQLite-Online-Backups mit Rotation; manuelle Sicherung per CLI/UI. |
| Nachvollziehbarkeit | Audit-Log (Logins, Fehlversuche, 2FA-Ereignisse, Passwortänderungen, Downloads, Exporte, Anonymisierungen, Backups) mit IP, einsehbar für Admins. |

## DSGVO

- **Auskunft & Datenübertragbarkeit (Art. 15/20):** Jeder Nutzer kann seine Daten als JSON exportieren („Konto & Sicherheit“).
- **Löschung (Art. 17):** Nutzer stellen einen Löschantrag; der Admin anonymisiert nach Prüfung der Aufbewahrungsfristen
  (Name, E-Mail, Telefon, Fragebogen, Musik, Dokumente werden entfernt; Abrechnungsdaten bleiben pseudonymisiert erhalten).
- **Datenminimierung & Zweckbindung:** Es werden nur planungsrelevante Daten erhoben; Kunden erteilen im Fragebogen eine Einwilligung zur Weitergabe an den DJ.
- **Sitzungen:** Nutzer sehen aktive Sitzungen und können andere beenden; Sitzungen laufen nach `SESSION_HOURS` ab.
- **Noch zu ergänzen durch den Verantwortlichen:** Datenschutzerklärung/Impressum (Texte), Verzeichnis der Verarbeitungstätigkeiten,
  ggf. AV-Vertrag mit dem Hoster, Festlegung konkreter Löschfristen.

## Projektstruktur

```
cosmos-events/
├── src/
│   ├── server.js            Einstiegspunkt (HTTP/HTTPS, Bootstrap, Backups)
│   ├── app.js               Express-App, Security-Middleware, Routen
│   ├── auth.js              Sessions, RBAC, Event-Zugriff
│   ├── crypto.js            scrypt, AES-GCM, TOTP, Token
│   ├── db.js                SQLite-Schema
│   ├── questionnaire.js     Fragebogen-Schema, Validierung, Vollständigkeit
│   ├── progress.js          Fortschritt & Meilensteine
│   ├── finance.js           Gagenberechnung & Kennzahlen
│   ├── spotify.js           Spotify Web API
│   ├── backup.js            Verschlüsselte Backups
│   ├── seed.js              Demo-Daten
│   └── routes/              auth, account, users, events, questionnaire, music, documents, schedule, finance, admin
├── public/                  Frontend (Vanilla JS SPA, ohne Build-Schritt)
├── test/                    Integrationstests (node:test)
├── config/                  Fragebogen-JSON (optional)
├── scripts/                 backup.js, restore.js
├── Dockerfile, docker-compose.yml, Caddyfile
└── .env.example
```

## API-Überblick

Alle Endpunkte unter `/api`, JSON, Session-Cookie. Auszug:

- `POST /auth/login`, `POST /auth/2fa`, `POST /auth/logout`, `GET /auth/me`
- `GET/POST /events`, `GET/PATCH/DELETE /events/:id`, `GET /events/:id/progress`
- `GET/PUT /questionnaire/:eventId`, `GET /questionnaire/schema`
- `GET /music/spotify/search?q=`, `GET/POST /music/events/:eventId`, `GET /music/events/:eventId/export.txt`
- `GET/POST /documents/events/:eventId`, `GET /documents/events/:eventId/:id/download`
- `GET /schedule/calendar`, `GET /schedule/events/:eventId/timeline`, `…/appointments`, `…/tasks`
- `GET /finance/dj`, `GET /finance/overview`, `GET/POST /finance/events/:eventId/payouts`
- `POST /account/password`, `POST /account/2fa/setup|enable|disable`, `GET /account/export`, `POST /account/deletion-request`
- Admin: `GET/POST/PATCH /users`, `POST /users/:id/reset-password|reset-2fa|anonymize`, `GET /admin/audit`, `GET/POST /admin/backups`, `GET /admin/stats`
