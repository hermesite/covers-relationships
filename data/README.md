# Graph Data Generation

The scripts in this directory generate the precomputed graph assets consumed by the frontend Covers and Originals pages.

## Output assets

Generated files are written to:

```text
frontend/data/graphs/
|-- covers/<artist_id>.json
|-- originals/<artist_id>.json
`-- manifest.json
```

Vite serves `frontend/data` as its public directory. The app loads graph assets from `/graphs/covers/<artist_id>.json` and `/graphs/originals/<artist_id>.json`.

These files are the runtime data source. Opening the app does not query SecondHandSongs; API traffic occurs only while running generation commands or explicitly using the development proxy.

## npm workflows

Run these commands from `frontend/`.

### Selected artist: two-step workflow

Generate Covers and Originals performance data for one selected artist:

```sh
ARTIST_ID=524 npm run generate:performances:artist
```

This first command performs no MusicBrainz, Wikidata, Deezer, or image-probe requests. Cover-artist nodes are written with `imageUrl: null`, while `artistPictureResolved` uses the picture URL already returned by SecondHandSongs.

Retrieve images for the selected artist and artists in its Covers graph:

```sh
ARTIST_ID=524 npm run generate:images:artist
```

The image command reads the existing `covers/<artist_id>.json`, stores all successfully probed selected-artist images in `artistPictures`, retrieves up to 40 cover-artist images, and updates that file in place. Exact-name image matches are deduplicated but are not capped. The Covers page displays every `artistPictures` entry as a two-column mosaic, adding rows as needed. The command does not regenerate performance data or the Originals graph.

The former command remains available as an alias for performance generation:

```sh
ARTIST_ID=524 npm run generate:data:artist
```

During graph development, rerun only `generate:performances:artist`. Run `generate:images:artist` when artist names or final visual assets need refreshing.

### Bulk and maintenance workflows

The bulk and maintenance commands below generate performance graph data only. Run `generate:images:artist` separately for each artist that needs refreshed Covers images.

Reset all generated graph files and freshly generate only the first artist in `src/constants/artistOptions.js`:

```sh
npm run reset:data
```

Clear both API caches and freshly regenerate every artist in the selector:

```sh
npm run refresh:cache
```

Generate the Python script's built-in default artist set:

```sh
npm run generate:data
```

Generate every artist in `src/constants/artistOptions.js`:

```sh
npm run generate:data:options
```

Use the local Vite proxy instead of the upstream API by starting Vite first and setting `SHS_BASE_URL`:

```sh
SHS_BASE_URL=http://localhost:5173/api/secondhandsongs npm run generate:data
```

## Direct Python usage

Run these commands from the repository root:

```sh
python3 data/generate_graph_data.py --artist 524
python3 data/generate_graph_data.py --artists 194 524
python3 data/generate_graph_data.py --artists 194 524 --no-cache
python3 data/generate_cover_images.py --artist 524
```

Use `--output <path>` to override `frontend/data/graphs` and `--artist-timeout-seconds 0` to disable the per-artist timeout.

Generation includes all performances and cover originals by default. For a deliberately partial development sample, set `MAX_PERFORMANCE_REQUESTS` and/or `MAX_ORIGINAL_REQUESTS` to positive integers.

## Scripts

- `generate_graph_data.py`: fetches API data and writes Covers and Originals graph JSON.
- `generate_cover_images.py`: enriches an existing Covers graph with artist images.
- `generate_from_options.mjs`: reads artist IDs from the frontend selector and invokes the Python generator.
- `manage_graph_data.mjs`: implements graph reset and cache refresh operations.
- `data-sources/`: exploratory image and external metadata utilities.

## Caches and failures

The Python generator and Vite proxy share `data/.cache/`. Successful endpoint responses are persisted there, so repeated development runs request only missing data. Responses fetched during one command are also reused in memory when `--no-cache` is set.

The anonymous SecondHandSongs limits are sliding windows of 20 requests per minute, 200 per hour, and 1000 per day. The generator and proxy persist request timestamps in `data/.cache/_sent.json` and wait for legal request slots. A cold anonymous artist generation can therefore take several minutes. The default artist timeout is 15 minutes.

When `SHS_API_KEY` is set, the generator and proxy read the `X-RateLimit-Minute-*` and `X-RateLimit-Hour-*` response headers and use the higher limits assigned to that key. Request a key at <https://secondhandsongs.com/request-api-key> when faster cold-cache generation is needed.

`reset:data` removes `frontend/data/graphs` before generating the default artist. `refresh:cache` removes cached endpoint responses but preserves the quota ledger before regenerating all selector artists. Both commands bypass old endpoint entries.

HTTP 403 and 429 responses are retried with quota-aware waits. Generation returns a nonzero exit code unless every selected performance and cover-original request succeeds, and existing artist graph files remain unchanged on failure.

The separate image command tries SecondHandSongs pictures, Wikidata through MusicBrainz, and Deezer for the selected artist. Cover-artist nodes use Deezer results. Selected URLs are stored as `artistPictureResolved` and `networkData[].data.imageUrl`.

SecondHandSongs disambiguation suffixes at the end of artist names are removed for external image searches. For example, `Carl Perkins [US1]` is searched as `Carl Perkins`; the original qualified name remains unchanged in the graph display.

## Environment variables

```sh
export SHS_API_KEY="..."
export DISCOGS_TOKEN="..."
export MUSICBRAINZ_USERNAME="..."
export MUSICBRAINZ_PASSWORD="..."
export MUSICBRAINZ_APP_NAME="HermesiteCovers"
export MUSICBRAINZ_APP_VERSION="0.1"
export MUSICBRAINZ_CONTACT="you@example.com"
```

`SHS_API_KEY` is used by the graph generator. The Discogs and MusicBrainz variables are used by scripts under `data-sources/`.

## Artist ID reference

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