# TatortTracker

Installierbare PWA zum Bewerten von Tatort-Folgen.

## Start (lokal)

Service Worker laufen nur über `http://localhost` oder `https`.

### Option 1: Python

```bash
python -m http.server 5173
```

Dann öffnen: `http://localhost:5173`

### Option 2: Node

```bash
npx serve .
```

## Features

- Installierbar auf Android und iOS (über Browser-Installfunktion / Zum Home-Bildschirm)
- Offline-fähige Shell durch Service Worker
- Bewertungen lokal auf dem Gerät gespeichert (`localStorage`)
- Designvorgaben:
  - App-Hintergrund `#000000`
  - Standard-Textfarbe weiß
  - Titel-Schrift: Futura Black (mit Fallback)
  - Text-Schrift: Futura Light (mit Fallback)

## Deployment auf GitHub Pages

Dieses Repo enthält bereits den Workflow `/.github/workflows/deploy-pages.yml`.

### 1) Repository auf GitHub anlegen und pushen

```bash
git init
git add .
git commit -m "Initial TatortTracker"
git branch -M main
git remote add origin https://github.com/<DEIN-USER>/<DEIN-REPO>.git
git push -u origin main
```

### 2) GitHub Pages aktivieren

Auf GitHub im Repo:

- `Settings` → `Pages`
- `Source`: **GitHub Actions**

Der Workflow deployt danach automatisch bei jedem Push auf `main`.

### 3) URL öffnen

Deine App ist dann erreichbar unter:

`https://<DEIN-USER>.github.io/<DEIN-REPO>/`

### 4) Auf dem Handy installieren

- Android (Chrome): Menü → **App installieren** / **Zum Startbildschirm hinzufügen**
- iPhone (Safari): Teilen → **Zum Home-Bildschirm**

## Hinweis zu Futura

Futura ist häufig nicht als Webfont standardmäßig verfügbar. Diese App nutzt daher die System-Schrift, wenn Futura auf dem Gerät vorhanden ist, sonst fällt sie auf ähnliche Sans-Serif-Schriften zurück.
