# Cyberheld DB

Desktop-App zur Beweissicherung von Facebook-Kommentaren (Electron + Next.js + SQLite + Puppeteer Stealth).

## Inhalt
- Features
- Voraussetzungen
- Schnellstart (Entwicklung)
- Bedienung
- Screenshots (fehlende/ausgewählte)
- Konfiguration (CHROME_PATH, Datenpfade)
- Troubleshooting

## Features
- JSON-Import von Facebook-Kommentardaten
- Lokale SQLite-DB (Posts, Comments)
- Kommentarliste mit Sticky-Aktionen, Suche folgt
- Detail-Modal: Kommentar-URL, Datum, Text, Likes, Antworten, Threadtiefe, Profil-ID/-Name/-Link
- Screenshots: Button „Screenshots (fehlende)“ und „Screenshots (ausgewählte)“

## Voraussetzungen
- Node.js 18+ (empfohlen)
- Git
- Chrome oder Edge installiert (Puppeteer nutzt vorhandene Installation)

## Schnellstart (Entwicklung)
1) Abhängigkeiten installieren
```powershell
npm install
```

2) Next.js Dev-Server starten (Terminal A)
```powershell
npm run dev:next
```
Warten bis „Ready“ (z. B. http://localhost:3000).

3) Electron im zweiten Terminal starten (Terminal B)
```powershell
$env:NODE_ENV="development"; npx electron electron/main.js
```
Hinweis: Electron versucht automatisch die Ports 3000, 3001, 3002.

Optional (ein Terminal):
```powershell
npm run dev
```
Falls sich kein Fenster öffnet, bitte den 2‑Terminal‑Weg verwenden.

## Bedienung
- Startseite: Posts-Übersicht, JSON importieren
- Kommentarseite: Liste aller Kommentare eines Posts
  - Sticky-Aktionsspalte links: Details, Screenshot öffnen
  - Checkbox pro Zeile + „Alle auswählen“ im Header
  - Buttons oben rechts: „Screenshots (ausgewählte)“, „Screenshots (fehlende)“

## Screenshots
- „Screenshots (fehlende)“: Erstellt Screenshots für alle Kommentare ohne vorhandenen Screenshot
- „Screenshots (ausgewählte)“: Erstellt Screenshots nur für markierte Kommentare

## Konfiguration
- Chrome/Edge-Pfad (optional, falls nicht automatisch gefunden):
```powershell
$env:CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
```
Unter macOS/Linux: `CHROME_PATH=/pfad/zu/chrome` vor den Startbefehl setzen.

- Datenpfade (Windows):
  - DB: `%APPDATA%/cyberheld-db/data/cyberheld.db`
  - Screenshots: `%APPDATA%/cyberheld-db/screenshots/<postId>/<commentId>.png`

## Troubleshooting
- Electron-Fenster öffnet nicht / ERR_CONNECTION_REFUSED:
  - Zuerst `npm run dev:next` starten, dann Electron in zweitem Terminal.
  - Ports prüfen (3000/3001/3002). Bei Bedarf Next neu starten.

- better-sqlite3 „NODE_MODULE_VERSION“ Fehler:
```powershell
npx electron-rebuild
```
Danach Electron erneut starten.

- Weißes Fenster / GPU-Fehler auf Windows:
  - Hardwarebeschleunigung ist in `electron/main.js` deaktiviert; das ist beabsichtigt.

- 404 auf `_next/static/*` im Dev:
  - Next neu starten, danach Electron neu starten.

## Lizenz
MIT
