# DevOps + DSA Roadmap

## What this project is
This is a static learning dashboard for a combined DevOps/SRE roadmap and a DSA interview preparation roadmap. It renders roadmap data from JSON files in the browser and stores learner progress in browser localStorage.

## Features
- Multi-route roadmap dashboard with DevOps, DSA, Projects, Interview, and Progress screens
- Expandable nested roadmap tree
- Per-topic and per-item progress tracking
- Search across roadmap content
- Progress export/import and reset actions
- Static deployment without a backend

## How to run locally
From the project root:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

Do not open the HTML file directly in the browser because the app fetches JSON data and browser security blocks local file JSON loading.

## Project structure

```text
/
  index.html
  css/
  js/
  data/
  backups/
  README.md
```

## Roadmap data locations
- DevOps roadmap: `data/devops/roadmap.json`
- DSA roadmap: `data/dsa/roadmap.json`
- Projects roadmap: `data/projects/roadmap.json`
- Interview roadmap: `data/interview/roadmap.json`
- Route manifest: `data/manifest.json`

The roadmap content is data-driven. Edit the JSON files in the `data/` folder rather than hardcoding UI content.

## Progress storage
Progress is stored in the browser using `localStorage` under the app's roadmap keys. This means progress is device/browser-specific and persists across reloads on the same origin.

## Deployment
This project is a static website and can be deployed to any standard static host, such as GitHub Pages, Netlify, Vercel static hosting, or any web server that serves the project directory.

## Important notes
- Keep the app served over HTTP(S) instead of opening the file directly.
- Preserve the JSON data structure and roadmap IDs when editing content.
- Backups for the production roadmap files are stored in the `backups/` directory and are not used by the live app.
