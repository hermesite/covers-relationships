# Secondhand Covers

## Run locally

Use Node.js 20.19+ or 22.12+ (required by Vite 7).

```sh
npm ci
npm start
```

The app uses React 19 with the `createRoot` API and Vite. It remains a
client-rendered app; Next.js is not needed for the existing static graph data
and local API proxy. Commit dependency lockfile changes when upgrading packages.

The graph pages (`/covers` and `/originals`) read precomputed JSON files from `data/graphs`. See [Graph Data Generation](../data/README.md) for generation, reset, cache refresh, Python, and asset documentation.

On `/covers`, a song's `coverReleases` lists albums by the selected artist, including `imageUrl` when matching cover artwork is found. Shared album nodes connect those songs to the selected artist; songs without a listed album remain directly connected.
Albums are ordered by the earliest selected-artist performance year recorded for each release; release references do not provide a separate album release date.

## Available URLs

### App URLs

- Dev server: http://localhost:5173
- Preview server (after build): http://localhost:4173

Use these commands:

```sh
npm run build
npm run preview
```

### API management and proxy URLs

The app uses a local Vite plugin that proxies requests to the SecondHandSongs API.

- Local API base URL: http://localhost:5173/api/secondhandsongs
- Upstream API base URL: https://api.secondhandsongs.com

Example local endpoints:

- http://localhost:5173/api/secondhandsongs/artist/194
- http://localhost:5173/api/secondhandsongs/performance/24127
- http://localhost:5173/api/secondhandsongs/search?commonName=David%20Bowie

Notes:

- Only GET requests are supported by the local proxy.
- Allowed API paths begin with: /artist, /performance, /work, /release, /label, /search.
- Optional API key env var: SHS_API_KEY
- Cached responses and the shared API quota ledger are stored under `../data/.cache/`.
- The graph pages themselves read static files and do not call the proxy on user access.