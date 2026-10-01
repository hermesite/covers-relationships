# Secondhand Covers

## Run locally

```sh
npm install
npm run generate:data
npm start
```

The graph pages (`/covers` and `/originals`) now read precomputed JSON files from `public/data/graphs`.

## Generate graph data (offline cache)

Generate data for all artists in the selector:

```sh
npm run generate:data
```

Generate using the local Vite proxy (closest to client behavior):

```sh
SHS_BASE_URL=http://localhost:5173/api/secondhandsongs npm run generate:data
```

Generate specific artist IDs only:

```sh
/usr/bin/python3 data/generate_graph_data.py --artists 194 524
```

Generate one artist only (incremental update):

```sh
ARTIST_ID=524 npm run generate:data:artist
```

This command accepts any artist ID, even if that ID is not currently present in `src/constants/artistOptions.js`.

Equivalent direct Python command:

```sh
/usr/bin/python3 data/generate_graph_data.py --artist 524
```

Notes:

- Script location: `data/generate_graph_data.py`
- Output files:
  - `public/data/graphs/covers/<artist_id>.json`
  - `public/data/graphs/originals/<artist_id>.json`
- Endpoint cache is reused from:
  - `data/.cache/`
  - `.shs-cache/`
- If SHS rate limits your IP (HTTP 403), the script still writes fallback files with an `error` field so the app remains loadable.
- To improve generation success under rate limits, set `SHS_API_KEY` before running the script.
- Artist image resolution in generator uses fallback candidates (SHS picture, Wikidata via MusicBrainz, Deezer) and stores the selected URL in `artistPictureResolved`.

### Optional environment variables

```sh
export SHS_API_KEY="..."
export DISCOGS_TOKEN="..."
export MUSICBRAINZ_USERNAME="..."
export MUSICBRAINZ_PASSWORD="..."
export MUSICBRAINZ_APP_NAME="HermesiteCovers"
export MUSICBRAINZ_APP_VERSION="0.1"
export MUSICBRAINZ_CONTACT="you@example.com"
```

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
- Cached responses are stored under .shs-cache/

## List of possible artist values (reference)

```json
[
  { "id": 194, "name": "David Bowie" },
  { "id": 277, "name": "The Stooges" },
  { "id": 524, "name": "The Clash" },
  { "id": 604, "name": "Ramones" },
  { "id": 790, "name": "Mink Deville" },
  { "id": 2637, "name": "Duane Eddy" },
  { "id": 5158, "name": "Dr. John" },
  { "id": 9258, "name": "King Curtis" },
  { "id": 22392, "name": "Amy Winehouse" },
  { "id": 30689, "name": "Morphine" },
  { "id": 37977, "name": "Kyuss" },
  { "id": 112184, "name": "Rosalia" }
]
```