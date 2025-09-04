# Cyberheld-DB - Beweissicherungs-Tool

## Allgemeine App Information

**Cyberheld-DB** ist eine Desktop-Anwendung zur Beweissicherung von Facebook-Kommentaren. Die App ermöglicht es, JSON-Dateien mit Facebook-Kommentardaten zu importieren, Screenshots von Kommentaren automatisch zu erstellen und alle Daten in einer lokalen Datenbank zu verwalten.

### Feature Liste
- ✅ JSON-Import von Facebook-Kommentardaten
- ✅ SQLite-Datenbank zur lokalen Speicherung
- ✅ Übersichtliche Post-Verwaltung
- ✅ Kommentar-Anzeige in Tabellen/Listen
- ✅ Kommentar-Details-Modal mit Metadaten
- ✅ Batch-Screenshot-Button in der Kommentarseite (fehlende)
- ✅ Checkbox-Auswahl und Button „Screenshots (ausgewählte)”
- ✅ Export (JSON/PDF) inkl. Auswahl einzelner Kommentare und pro-Kommentar-Dateinamen
- ✅ Prüfsummen (SHA256) für Screenshots: Speicherung in DB, Anzeige, Export
- ⏳ Automatische Screenshot-Erstellung (Phase 2)
- ⏳ Kommentar-Detail-Popup mit Metadaten (Phase 3)
- ⏳ Screenshot-Verwaltung und -Anzeige (Phase 3)

## App Struktur

### Ordner- und Dateistruktur
```
cyberheld-db/
├── src/                     # Next.js Frontend
│   ├── app/                 # Next.js App Router
│   │   ├── globals.css      # Globale Styles mit Tailwind
│   │   ├── layout.tsx       # Root Layout Component
│   │   └── page.tsx         # Hauptseite (Posts Übersicht)
│   ├── components/          # React Components
│   │   └── PostsList.tsx    # Posts-Liste Component
│   ├── lib/                 # Utility Functions
│   │   └── utils.ts         # Hilfsfunktionen (formatDate, truncateText, etc.)
│   └── types/               # TypeScript Definitionen
│       ├── facebook.ts      # Facebook-Datenstrukturen
│       └── ipc.ts           # IPC-Kommunikation Types
├── electron/                # Electron Backend
│   ├── services/            # Backend Services
│   │   ├── DatabaseService.js # SQLite-Datenbanklogik
│   │   └── BrowserService.js  # Puppeteer-Service
│   │   └── AIService.js       # OpenAI-gestützte Kommentar-Analyse (Batch, Short-IDs)
│   ├── main.js              # Electron Main Process
│   ├── preload.js           # Preload Script für IPC
│   └── tsconfig.json        # TypeScript Config für Electron
├── data/                    # SQLite Datenbank (zur Laufzeit)
├── screenshots/             # Gespeicherte Screenshots (zur Laufzeit)
├── dist/                    # Build Output
├── package.json             # NPM Dependencies & Scripts
├── tsconfig.json            # TypeScript Config für Next.js
├── tailwind.config.js       # Tailwind CSS Konfiguration
├── postcss.config.js        # PostCSS Konfiguration
├── next.config.js           # Next.js Konfiguration
└── .gitignore               # Git Ignore Regeln
```

## Datei Liste

### Frontend (Next.js/React)
- **src/app/page.tsx**: Hauptseite mit Posts-Übersicht, JSON-Import-Funktionalität
  - Externe Funktionen: `window.electronAPI.*` (IPC-Kommunikation)
- **src/app/layout.tsx**: Root Layout mit Header und Navigation
- **src/app/globals.css**: Tailwind CSS Styles mit Custom Components
- **src/components/PostsList.tsx**: Tabellen-Component für Posts-Anzeige
  - Props: `posts: Post[]`, `onRefresh: () => void`
- **src/app/posts/[postId]/page.tsx**: Kommentarseite
  - Aktionen: Details öffnen, Screenshot öffnen
  - Auswahl: Checkbox pro Zeile, „Alle auswählen“ im Header
  - Buttons: „Screenshots (ausgewählte)“, „Screenshots (fehlende)“
- **src/lib/utils.ts**: Utility Functions
  - Exports: `formatDate()`, `truncateText()`, `extractDomain()`, `isElectron()`

### Backend (Electron)
- **electron/main.js**: Electron Main Process, App-Initialisierung, IPC-Handler
  - Klasse: `CyberheldApp` - Hauptanwendungslogik
  - IPC Channels: Import, Posts abrufen, Kommentare abrufen, Datei-Dialoge
- **electron/services/BrowserService.js**: Puppeteer + Stealth gesteuerter Browser-Service für Screenshots
  - `initBrowser(headless)` – initialisiert einen persistenten Browser
  - `takeScreenshot(commentUrl, postId, commentId, snippetText)` – erstellt Screenshot mit Beweisfokus:
    - Scrolling-Screenshot (Top→Kommentar): Vollseitenaufnahme und Zuschnitt vom Seitenanfang bis zum Ende des Ziel-Kommentars
    - Alternativ: gemeinsames Viewport-Fenster aus Post-Header und Kommentar
    - Fallback: FullPage-Screenshot, wenn der Bereich zu groß ist
  - `takeLikesScreenshot(commentUrl, postId, commentId, snippetText)` – öffnet die Likes-Liste (Dialog), scrollt diese vollständig ab und erstellt einen zusammengesetzten Screenshot (vertikales Stitching)
- **electron/services/ExportService.js**: Export von JSON und PDF (eingebettete Screenshots, Checksum-Ausgabe)
- **electron/preload.ts**: Preload Script für sichere IPC-Kommunikation
  - Exports: `window.electronAPI` Interface
- **electron/services/DatabaseService.js**: SQLite-Datenbankservice
  - Klasse: `DatabaseService` - Datenbank-CRUD-Operationen
  - Methoden: `initialize()`, `importJsonFile()`, `getPosts()`, `getComments()`

### Konfiguration
- **package.json**: NPM-Konfiguration mit Electron + Next.js Setup
- **tsconfig.json**: TypeScript-Konfiguration für Next.js
- **electron/tsconfig.json**: TypeScript-Konfiguration für Electron
- **tailwind.config.js**: Tailwind CSS Konfiguration
- **postcss.config.js**: PostCSS mit Tailwind und Autoprefixer
- **next.config.js**: Next.js Export-Konfiguration für Electron

### Type Definitionen
- **src/types/facebook.ts**: 
  - `FacebookComment` - Struktur der JSON-Importdaten
  - `Post` - Datenbank-Post-Struktur
  - `Comment` - Datenbank-Kommentar-Struktur
  - `DatabaseComment` - Erweiterte Kommentar-Struktur mit geparsten Metadaten
- **src/types/ipc.ts**: IPC-Kommunikation zwischen Frontend und Backend
  - `IPC_CHANNELS` - Konstanten für IPC-Channel-Namen
  - Request/Response Interfaces für alle IPC-Operationen

## Projektweite Variablen und Funktionen

### IPC-Kommunikation (electron/main.ts)
- **IPC_CHANNELS.IMPORT_JSON**: JSON-Datei importieren
  - Definiert in: `src/types/ipc.ts`
  - Verwendet in: `electron/main.ts`, `electron/preload.ts`, `src/app/page.tsx`
- **IPC_CHANNELS.GET_POSTS**: Alle Posts abrufen
  - Definiert in: `src/types/ipc.ts` 
  - Verwendet in: `electron/main.ts`, `electron/preload.ts`, `src/app/page.tsx`
- **IPC_CHANNELS.GET_COMMENTS**: Kommentare für Post abrufen
  - Definiert in: `src/types/ipc.ts`
  - Verwendet in: `electron/main.ts`, `electron/preload.ts`
- **IPC_CHANNELS.TAKE_SCREENSHOT / TAKE_SCREENSHOTS_BATCH**: Screenshots aufnehmen
  - Implementiert in: `electron/main.js` (ruft `BrowserService` und `DatabaseService.updateCommentScreenshot`)
 - **ai:analyze-comments**: KI-Analyse für ausgewählte Kommentare (batched)
   - Request: `{ commentIds: string[], lawText?: string, batchSize?: number }`
   - Response: `{ success: boolean, analyzed?: number, failed?: number, results?: Array<{comment_id, is_negative, confidence_score, reasoning}> }`

### Datenbank-Service (electron/services/DatabaseService.js)
- `DatabaseService.importJsonFile()` – JSON-Import-Logik
- `DatabaseService.getPosts()` – Posts aus DB laden
- `DatabaseService.getComments()` – Kommentare für Post laden
- `DatabaseService.updateCommentScreenshot()` – Speichert Screenshot-Pfad und SHA256-Checksumme
- `DatabaseService.updateCommentAiAnalysis()` – Speichert KI-Resultate je Kommentar (`is_negative`, `confidence_score`, `reasoning`, `ai_model`, `ai_analyzed_at`)
 - `DatabaseService.updateCommentLikesScreenshot()` – Speichert Pfad zum Likes-Screenshot

### AI-Service (electron/services/AIService.js)
- Batching bis 100 Kommentare; Short-IDs (`c1..cN`) zur Tokenreduktion
- Responses API mit JSON-Schema-Erzwingung; Retry bei transienten Fehlern

### UI-Erweiterung
- In `src/app/posts/[postId]/page.tsx`:
  - Buttons: „Analysieren (ausgewählte)“, „Analysieren (fehlende)“
  - Spalten: Negativ/Ja-Nein, Konfidenz, Begründung (gekürzt)
- In `src/components/CommentDetailsModal.tsx`:
  - Anzeige: Negativ, Konfidenz, Modell, Zeitpunkt, Begründung

### Global API (window.electronAPI)
- **window.electronAPI**: Globale Electron-API für Frontend
  - Definiert in: `electron/preload.ts`
  - Verwendet in: `src/app/page.tsx`
  - Methoden: `importJson()`, `getPosts()`, `getComments()`, `selectJsonFile()`
  - Likes: `takeLikesScreenshot({ postId, commentUrl, commentId, snippet })`

## Dependencies

### Haupt-Dependencies
- **electron**: Desktop-App Framework
- **next**: React Framework für Frontend
- **better-sqlite3**: SQLite-Datenbank
- **@heroicons/react**: Icon-Bibliothek
- **tailwindcss**: CSS Framework
- **fs-extra**: Erweiterte Dateisystem-Operationen

### Geplante Dependencies (Phase 2)
- **puppeteer-core**: Browser-Automatisierung für Screenshots
- **puppeteer-extra**: Puppeteer-Erweiterungen
- **puppeteer-extra-plugin-stealth**: Anti-Detection für Facebook
- **keytar**: Verschlüsselte Cookie-Speicherung

## Aktueller Status
**Phase 1 abgeschlossen** - Grundgerüst steht, App kann JSON-Dateien importieren und Posts anzeigen.
**Nächste Phase:** Screenshot-Engine mit Puppeteer implementieren.
