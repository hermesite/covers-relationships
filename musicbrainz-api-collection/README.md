# MusicBrainz Exploration Collection

Open this directory directly in Bruno as an OpenCollection YAML collection.
The 12 requests are read-only and cover artists, release groups and types,
release editions and tracklists, recordings, works, and Cover Art Archive images.

## Run

From the repository root, with Node.js 22.9+ and npm:

```sh
node musicbrainz-api-collection/run.mjs
node musicbrainz-api-collection/run.mjs 01-artists/02-info.yml
node musicbrainz-api-collection/run.mjs 02-release-groups/04-filter-by-type.yml
```

The runner uses Bruno CLI 4.2.0, spaces requests at least 1.2 seconds apart,
and stops at the first failed request or test. MusicBrainz allows at most one
request per second per client/IP; do not run multiple MusicBrainz jobs in parallel.
A 503 can indicate server load or throttling. Retry later rather than increasing
the request rate. Collection tests check HTTP success and JSON API errors.

## Environment and Authentication

Public MusicBrainz metadata and Cover Art Archive do **not** need authentication.
The collection identifies the client using `userAgent`, initially
`CoversRelationshipsExplorer/1.0 (hermesite@gmail.com)`. Update the contact if needed.
No named Bruno environment is required.

Your existing `MUSICBRAINZ_CLIENT_ID` and `MUSICBRAINZ_CLIENT_SECRET` in `data/.env`
are OAuth application credentials, **not** catalog API keys. These GET requests
deliberately do not send them. A local Git-ignored `.env` symlink makes the values
available in Bruno for future OAuth work; on a fresh checkout, create it with:

```sh
ln -s ../data/.env musicbrainz-api-collection/.env
```

Account-specific requests such as private collections, user tags, or data
submissions need a user-authorized OAuth access token. Client ID/secret alone
cannot substitute for that token. An authorization-code flow also needs a
registered redirect URI and user consent; it is not configured by this collection.
Do not paste the client secret into URLs, collection variables, or reports.
OAuth documentation: https://musicbrainz.org/doc/Development/OAuth2

## Exploration

Change collection variables in `opencollection.yml` or Bruno's collection editor.
Default entities are The Cramps, Songs the Lord Taught Us, and Human Fly.
Searches show candidates; copy the correct MBID into the corresponding variable.
Changing `artist`, `album`, or `track` does not automatically update MBIDs.
IDs are deliberately not taken from the first search result.

- `artistMbid`: artist identity, metadata and relationships to all entity types.
- `releaseGroupMbid`: the conceptual album/EP/single, grouping editions.
- `releaseMbid`: one specific edition with date, country, labels, media and tracks.
- `recordingMbid`: an audio recording, not necessarily a unique song composition.
- `releaseType`: defaults to `ep`; try `album`, `single`, or `live`.
- `limit`/`offset`: pagination. Use response counts; increase offsets by returned
  item count. Lookup includes can cap linked entities at 25, so use browse requests.

Release groups expose `primary-type` (Album, EP, Single, etc.) and
`secondary-types` (Compilation, Live, Remix, etc.). Release `media[].format`
describes the carrier, such as CD or Vinyl, rather than the release-group type.
Recording `work` relationships link recordings to compositions; missing links
or incomplete credits are possible. MusicBrainz has metadata, not audio playback.
Search uses Lucene syntax: escape special characters when exploring unusual names.
Bruno encodes the URL, so do not pre-encode query quotes or `inc` plus separators.

The artist detail request includes relationships to areas, artists (including
band members), events, genres, instruments, labels, places, recordings, releases,
release groups, series, URLs, and works. Inspect the response's `relations` array
for `type`, `target-type`, `direction`, dates, attributes, and the linked entity.
The console summarizes relationship counts by target type and lists external URLs.
Only relationships directly attached to the selected artist are included;
relationships of linked entities require their own lookups. Empty or missing
relationship categories reflect available MusicBrainz data, not an API error.

## Images

MusicBrainz does not host artist portraits. Artist `url-rels` can include an
`image` relationship to Wikimedia Commons, plus Wikidata and Discogs links.
The default artist has a direct Commons image link. If only Wikidata is present,
inspect its P18 statement and resolve the file through Wikimedia Commons.

The Cover Art Archive request returns album images, `front`/`back` flags,
and thumbnail URLs; these are not artist portraits. A 404 legitimately means
no artwork is available for the selected group. This will fail the success test,
not mean your credentials are wrong. Missing metadata likewise can return 404.
Respect source attribution, image licenses, and API usage terms.

API documentation: https://musicbrainz.org/doc/MusicBrainz_API
Cover Art Archive: https://musicbrainz.org/doc/Cover_Art_Archive/API