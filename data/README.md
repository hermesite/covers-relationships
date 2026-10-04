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

Run these commands from `data/`, where the Python scripts and data npm scripts live.

### Band relation details

Generate the selected band's relations and fetch extended data for each related artist:

```sh
npm run generate:band-detail
npm run generate:band-detail -- --artist 14076
```

The output is written to `frontend/data/band-detail/<artist_id>.json` and served by the app at `/band-detail/<artist_id>.json`. The Band Detail view is available at `/band-detail?artistId=14076`.

Check whether an IP-wide API block has cleared:

```sh
npm run monitor:api
```

Wait with one probe every 15 minutes and generate band details as soon as access returns:

```sh
npm run monitor:api:wait
```

The API does not always return a reset header for error `10007`, so monitoring requires a periodic request. Keep the interval low-frequency; `--interval-seconds` cannot be set below 60 seconds. To use an HTTP/HTTPS proxy you control, run the monitor from `data/`:

```sh
python3 monitor_shs_api.py --proxy http://proxy.example:8080 --run-band-detail
```

The proxy option is passed to `generate_band_detail.py` after recovery. Avoid untrusted public proxies, which can inspect traffic and may violate the upstream service's usage limits.

### Selected artist: two-step workflow

Generate Covers and Originals performance data for one selected artist:

```sh
ARTIST_ID=524 npm run generate:performances:artist
```

This first command performs no MusicBrainz, Wikidata, Deezer, or image-probe requests. Cover-artist nodes are written with `imageUrl: null`, while `artistPictureResolved` uses the picture URL already returned by SecondHandSongs.

Retrieve images for the selected artist, related performers, and releases in both graph files:

```sh
ARTIST_ID=524 npm run generate:images:artist
```

The image command updates the existing `covers/<artist_id>.json` and, when present, `originals/<artist_id>.json` in place without regenerating performances. It fills missing performer images in both graphs, including artists who cover the selected artist's original songs. Existing artist images and the selected-artist mosaic are retained. By default, at most 40 missing performers are looked up per graph.

To use Discogs specifically for missing artist images in the combined Covers view, load `data/.env` into the terminal and run from `data/`:

```sh
ARTIST_ID=14076 npm run generate:images:artist -- --discogs-artists-only --max-artists 99
```

To regenerate artist portraits with Discogs as the preferred source, including the central artist node:

```sh
ARTIST_ID=14076 npm run generate:images:artist -- --discogs-first --max-artists 200
```

This refreshes non-curated performer portraits in both graph files and places the selected artist's downloaded Discogs image first in `artistPictures`. Existing images remain as fallbacks when Discogs has no downloadable match. Alternative Discogs portraits manually selected with an explicit record ID are preserved. Release artwork, performances and graph relationships are not regenerated.

This mode skips release artwork and performance requests. It defaults to both graph files; use `--graph covers` or `--graph originals` to restrict it. Existing images are retained. Add `--refresh-artists` to replace them only when a Discogs match downloads successfully. Discogs portraits are saved under `frontend/data/images/artists/`, avoiding cross-origin canvas restrictions. Combined artist credits are searched in full first, then by their explicitly named lead performer; `imageCredit` records whose portrait is shown, and the graph label is unchanged.

Albums, EPs, and singles in both graphs are also enriched. Releases are deduplicated by URI across both sources, so shared artwork is applied to every matching release reference. All release artwork is validated and downloaded to `frontend/data/images/releases/`, then served from `/images/releases/` to avoid cross-origin canvas restrictions. Compilation and guest-appearance matches require a matching release title and a graph track explicitly credited to the selected artist. Missing or ambiguous matches remain without artwork rather than using another artist's release.

To repair release artwork without changing artist images or regenerating performances:

```sh
ARTIST_ID=14076 npm run generate:images:artist -- --releases-only
```

To replace one graph artist's generic portrait with a Discogs alternative, run from `data/` with `DISCOGS_TOKEN` loaded. Preview the gallery first:

```sh
ARTIST_ID=14076 npm run generate:image:artist -- --artist-name "The Sonics" --discogs-id 226982 --list-images
```

Choose a numbered image to download and update the graph:

```sh
ARTIST_ID=14076 npm run generate:image:artist -- --artist-name "The Sonics" --discogs-id 226982 --image-index 2
```

`ARTIST_ID` identifies the selected band's dataset; `--artist-name` identifies the performer node to update. `--discogs-id` is optional for unique name matches and required for ambiguous Discogs identities. Without `--image-index`, the command prefers a different secondary image rather than repeating the recorded source URL. `--list-images` makes no changes. Only matching nodes in the Covers and Originals files are updated; use `--graph covers` or `--graph originals` to restrict this. Qualifier suffixes such as `[US1]` are ignored for matching. Existing `imageCredit` names also match combined performer credits; use `--node-uri` if multiple graph nodes share a normalized name. Failed lookups or downloads leave graph files unchanged. Alternative portraits are saved locally with distinct filenames to avoid browser cache reuse.

An explicit `--discogs-id` overrides differences between Discogs and SecondHandSongs names. `--list-images` can preview that record even when `--artist-name` does not match a graph label. To apply its portrait, use the graph's exact label or explicitly select `--node-uri`. The graph label remains unchanged, while `imageCredit` records the actual Discogs artist name. For example:

```sh
ARTIST_ID=14076 npm run generate:image:artist -- --artist-name "The Johnny Burnette Trio" --discogs-id 722937 --node-uri https://api.secondhandsongs.com/artist/2140 --image-index 2
```

The Cramps Originals graph has 99 performer nodes. To attempt image retrieval for all of them, together with all albums, EPs, and singles:

```sh
ARTIST_ID=14076 npm run generate:images:artist -- --max-artists 99
```

Selected-artist images are stored in `artistPictures` in the Covers graph. Exact-name image matches are deduplicated but are not capped. The Covers page displays these as a two-column mosaic and combines both graph files. Song nodes are text-only: covers use teal labels matching their original performers, while originals use rust labels matching their cover performers. The default layout separates cover songs to the left and original songs to the right, with shared releases retained as single nodes. Performers are placed close to connected performances rather than in separate artist bands; performers connected to multiple songs are anchored beside one of them.

In the default No overlap layout, cover-only and original-only albums, EPs, and singles cluster with their connected songs and performers. Releases containing both sources remain in the central band beside the selected artist, including when source filters are applied.

Song nodes include `coverArtistCount`, the number of distinct covering performer URIs in the performance response. Duplicate recordings by the same performer count once. All song labels use the same maximum font size of 30 px, regardless of source or covering-artist count.

The former command remains available as an alias for performance generation:

```sh
ARTIST_ID=524 npm run generate:data:artist
```

During graph development, rerun only `generate:performances:artist`. Run `generate:images:artist` when artist names or final visual assets need refreshing.

### Bulk and maintenance workflows

The bulk and maintenance commands below generate performance graph data only. Run `generate:images:artist` separately for each artist that needs graph images.

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

Run these commands from `data/`:

```sh
python3 generate_graph_data.py --artist 524
python3 generate_graph_data.py --artists 194 524
python3 generate_graph_data.py --artists 194 524 --no-cache
python3 generate_cover_images.py --artist 524
```

Use `--output <path>` to override `frontend/data/graphs` and `--artist-timeout-seconds 0` to disable the per-artist timeout.

Generation includes all performances and cover originals by default. For a deliberately partial development sample, set `MAX_PERFORMANCE_REQUESTS` and/or `MAX_ORIGINAL_REQUESTS` to positive integers.

## Scripts

- `generate_graph_data.py`: fetches API data and writes Covers and Originals graph JSON.
- `generate_band_detail.py`: fetches a band's relations and extended artist details for the Band Detail view.
- `generate_cover_images.py`: enriches existing Covers and Originals graphs with performer and release artwork.
- `generate_from_options.mjs`: reads artist IDs from the frontend selector and invokes the Python generator.
- `manage_graph_data.mjs`: implements graph reset and cache refresh operations.
- `data-sources/`: exploratory image and external metadata utilities.

## Caches and failures

The Python generator and Vite proxy share `data/.cache/`. Successful endpoint responses are persisted there, so repeated development runs request only missing data. Responses fetched during one command are also reused in memory when `--no-cache` is set.

The anonymous SecondHandSongs limits are sliding windows of 20 requests per minute, 200 per hour, and 1000 per day. The generator and proxy persist request timestamps in `data/.cache/_sent.json` and wait for legal request slots. A cold anonymous artist generation can therefore take several minutes. The default artist timeout is 15 minutes.

When `SHS_API_KEY` is set, the generator and proxy read the `X-RateLimit-Minute-*` and `X-RateLimit-Hour-*` response headers and use the higher limits assigned to that key. Request a key at <https://secondhandsongs.com/request-api-key> when faster cold-cache generation is needed.

`reset:data` removes `frontend/data/graphs` before generating the default artist. `refresh:cache` removes cached endpoint responses but preserves the quota ledger before regenerating all selector artists. Both commands bypass old endpoint entries.

HTTP 403 and 429 responses are retried with quota-aware waits. Generation returns a nonzero exit code unless every selected performance and cover-original request succeeds, and existing artist graph files remain unchanged on failure.

If generation ends with `API 10007: Too many requests from this IP`, the upstream IP-wide sliding window is exhausted. It can include requests made outside this repository or by other machines sharing the public IP, so the local ledger may show fewer calls. Wait for the upstream window to clear or configure `SHS_API_KEY`; do not repeatedly clear the endpoint cache, because cached responses reduce future quota use.

The separate image command tries SecondHandSongs pictures, Wikidata through MusicBrainz, and Deezer for the selected artist. Related performer nodes in both graphs use Deezer results with MusicBrainz and Discogs fallbacks. Selected URLs are stored as `artistPictureResolved` and `networkData[].data.imageUrl`.

SecondHandSongs disambiguation suffixes at the end of artist names are removed for external image searches. For example, `Carl Perkins [US1]` is searched as `Carl Perkins`; the original qualified name remains unchanged in the graph display.

## Environment variables

Artwork enrichment also fills missing album images through MusicBrainz's Cover Art Archive and Discogs. Missing artist images use matched MusicBrainz Wikipedia/Wikidata relations, then Discogs. Successful metadata lookups are cached in `data/.cache/artwork/`; requests are paced, and existing artwork is retained when a lookup fails. Album title and artist must match, so ambiguous compilations and combined artist credits can remain unresolved.

Keep credentials in the ignored `data/.env` and load them into the terminal before running image generation. MusicBrainz public metadata and Cover Art Archive reads do not require OAuth authentication. `MUSICBRAINZ_CLIENT_ID` and `MUSICBRAINZ_CLIENT_SECRET` identify an OAuth application, not an access token; authenticated account actions would additionally require user authorization. Discogs artwork search uses `DISCOGS_TOKEN` in an authorization header.

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