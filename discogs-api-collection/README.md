# Discogs Exploration Collection

Open this directory directly in Bruno as an OpenCollection YAML collection.
The 10 requests are read-only: artist search/details/photos/discography,
master albums and editions, release search/details/formats/artwork, and token identity.

## Run With the Existing Token

From the repository root, with Node.js 22.9+ and npm:

```sh
node discogs-api-collection/run.mjs
node discogs-api-collection/run.mjs 01-artists/02-info.yml
node discogs-api-collection/run.mjs 03-releases/02-info.yml
node discogs-api-collection/run.mjs 04-auth/01-identity.yml
```

The runner reads only `DISCOGS_TOKEN` from `data/.env`, supplies it to Bruno,
redacts it from console output, spaces requests 1.2 seconds apart, and stops
at the first failed request or test. Nothing changes your account or collection.
Requests send the token in an `Authorization: Discogs token=...` header, not URLs.
Avoid verbose/shared reports containing resolved authorization headers.

For Bruno desktop, a local Git-ignored `.env` symlink loads your existing token.
On a fresh checkout, create it before opening the collection:

```sh
ln -s ../data/.env discogs-api-collection/.env
```

No named environment is needed. Requests inherit the token and identifying
User-Agent from `opencollection.yml`. The identity request verifies the token's
actual account; it does not assume that your Discogs username equals `hermesite`.
The existing token may belong to a differently named account.

## Exploration

Change collection variables in Bruno or `opencollection.yml`.
Defaults are artist ID `39779` (The Cramps), master ID `53333`
(Songs The Lord Taught Us), and its main release ID `2367928`.
Searches log IDs; check the artist, title, date, country, and format before
copying an ID into the detail-query variables. Changing text search variables
does not automatically change IDs. Search can return unofficial editions and
similarly named records before the original album.

- Artist details provide `profile`, `members`, `urls`, and `images` when available.
- Artist discography items have `type=master` or `type=release`; use the matching
  endpoint for their IDs. `role` distinguishes main-artist and appearance credits.
- A master groups editions; `main_release` identifies one representative edition.
- Master versions list edition IDs, dates, countries, labels and format summaries.
- Release details expose `formats[].name`, `formats[].descriptions`, `tracklist`,
  credits, labels, genres, styles, identifiers, and images.
- `format` defaults to `EP`; try `Single`, `Album`, `LP`, `Vinyl`, or `CD`.
- `page`/`perPage` control pagination; inspect the `pagination` object for totals.

`formats[].name` describes the carrier (Vinyl, CD, etc.); descriptions may include
Album, EP, Single, LP, Reissue, Compilation, and other qualifiers. These labels
are community-maintained and can be incomplete. Discogs tracks are tracklist
entries, not globally addressable recording/composition entities like MusicBrainz.
It has no standalone song-detail endpoint or audio-download API.

## Images and Rate Limits

Artist photos and cover scans are separate `images` arrays. Prefer an appropriate
`type=primary` image, with `uri` for the full image and `uri150` for its thumbnail.
Scripts log the first three candidates; inspect the response for all available
images. The default artist returned actual image URLs during verification.
Returned URLs are signed: do not modify their path or resize segments.
Follow Discogs' image-use restrictions; availability is not a redistribution license.

Authenticated requests are generally limited to 60/minute. Inspect
`X-Discogs-Ratelimit`, `X-Discogs-Ratelimit-Used`, and
`X-Discogs-Ratelimit-Remaining`; image requests can have separate restrictions.
Do not run multiple batches in parallel. HTTP 401 indicates invalid/missing
authentication, 403 permission or policy restrictions, 404 a missing entity,
and 429 rate limiting. Stop and retry later when limited.

Documentation and terms: https://www.discogs.com/developers