# Last.fm Exploration Collection

Open `LAST FM` as a separate collection in Bruno (OpenCollection YAML).
There are 17 read-only GET requests. No login, API secret, session key, or email
is needed. `hermesite` is the public username; email is not an API parameter.

## Run With the Existing Key

From the repository root, with Node.js 22.9+ and npm:

```sh
node last-fm-api-collection/run.mjs
node last-fm-api-collection/run.mjs 02-artists/01-info.yml
node last-fm-api-collection/run.mjs 04-releases/01-info.yml
```

The runner reads only `LASTFM_API_KEY` from `data/.env`, supplies it to Bruno,
and redacts the key from its console output. It downloads the pinned Bruno CLI
on first use and spaces requests one second apart. Nothing modifies your Last.fm
account. Avoid verbose reports or shared request URLs: the API uses a query-string key.

The Bruno desktop app is configured locally with a Git-ignored symlink to the
existing dotenv file. Open `LAST FM` as a collection and run a request.
On a fresh checkout, create that link before opening the collection:

```sh
ln -s ../../data/.env 'last-fm-api-collection/LAST FM/.env'
```

This is a local symlink, not a credential copy. Do not commit it or export
resolved secrets. Alternatively, launch Bruno with `LASTFM_API_KEY` set in its
process environment. Requests reference `{{process.env.LASTFM_API_KEY}}`.

No named Bruno environment is required: this collection uses its own variables
and calls Last.fm directly over HTTPS. The SecondHandSongs `local-proxy` and
`upstream` environments do not apply to these requests.

## Exploration Order

1. `01-user`: profile, recent listens, and your top artists, albums, and tracks.
2. `02-artists`: biography, MBID, search, top songs/releases, tags, similar artists.
3. `03-tracks`: metadata, associated album/artwork, personalized playcount, search, tags.
4. `04-releases`: metadata, tracklist, cover images, search, and community tags.

Change collection variables in `LAST FM/opencollection.yml` or Bruno's collection
variables editor. Defaults are The Cramps, Human Fly, and Songs the Lord Taught Us.
`period` accepts `overall`, `7day`, `1month`, `3month`, `6month`, or `12month`.
Use `page` and `limit` to explore paginated results; inspect response `@attr`
for page counts. `user` supplies the username for rankings and listening history;
metadata requests use the API's `username` parameter for personal playcounts.
Album search is title-based: check the returned artist to avoid false matches.

## Album, EP, Single, and Other Release Types

Last.fm's `album` methods do **not** provide an authoritative structured release
type. Their results can include albums, EPs, singles, compilations, and duplicates;
top albums are popularity rankings, not a complete discography. Tags such as
`ep` or `single` are community labels, not reliable classification.

For structured types, enrich with MusicBrainz release groups:

```text
GET https://musicbrainz.org/ws/2/release-group/?query=releasegroup:"Songs the Lord Taught Us" AND artist:"The Cramps"&fmt=json
```

URL-encode the query and identify your client with a User-Agent. Inspect
`primary-type` (Album, EP, Single, etc.) and `secondary-types` (Live,
Compilation, Remix, etc.). Match artist and title before selecting a result.
Last.fm MBIDs may be empty or stale; verify whether a returned album MBID is a
MusicBrainz release or release group rather than assuming the entity type.
For release-level formats, Discogs provides `formats[].name` and
`formats[].descriptions` (e.g. Vinyl, LP, EP, Single). Neither is a Last.fm field.

## Artist Photos Versus Cover Artwork

- Artist `image[]` fields may be empty or return a generic placeholder.
  A basic The Cramps request returned the placeholder hash
  `2a96cbd8b46e442fc41c2b86b821562f` at every size. This is **not** a band photo.
  The collection's request with `username=hermesite`, `autocorrect=1`, and
  `lang=en` returned non-placeholder image URLs for the same artist. Treat
  these as candidates, not a guarantee that photos exist for every artist.
- Album covers are available in `album.image[]`, top-album responses, and
  `track.album.image[]`; recent tracks may also contain release artwork.
- Image entries use `#text` for the URL and `size` for the label. Prefer a
  non-empty `mega` or `extralarge` candidate, then fall back to smaller images.
- Artist-info and release-info scripts log non-placeholder candidates in Bruno's
  console. A candidate still needs checking for availability and suitability.
- For actual band/artist photos, use the project's existing Deezer, Discogs,
  or MusicBrainz -> Wikidata -> Wikimedia Commons lookups as fallbacks. Last.fm has no
  supported public artist-photo-gallery API. Album art is not an artist portrait.

Respect image licenses, source attribution, and Last.fm's API terms. MBIDs and
track metadata do not reliably distinguish every recording, mix, or performance;
use MusicBrainz recordings/releases when those distinctions matter.

## Errors and Validation

Collection tests check HTTP status and Last.fm's JSON `error` field, since API
errors can appear even with HTTP 200. Missing entities can legitimately fail a
request after changing defaults. Error 10 means an invalid API key; error 29
means rate limiting. Stop and retry later rather than launching parallel runs.

Documentation: https://www.last.fm/api