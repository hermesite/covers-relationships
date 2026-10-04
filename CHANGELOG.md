# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The project is in initial development (`0.x.y`); its public API is not yet stable.

## [Unreleased]

### Added

- Added a Band Family page with member portraits, roles, tenure periods, and linked group memberships.
- Expanded Band Detail with a band-activity timeline, release annotations, filters, source links, and member/release highlighting.
- Enriched band data with Discogs membership evidence, alias-aware member profiles, locally cached portraits, and verified album, EP, and single annotations, with MusicBrainz fallbacks.
- Added regression tests for membership parsing, identity matching, and release enrichment.

### Changed

- Made Band Detail the home page and added Band Family to primary navigation.
- Updated the band-detail generator documentation and separated band enrichment from SecondHandSongs API monitoring.

### Removed

- Removed the Covers Cards page and route.

## [0.1.0] - 2026-10-03

Initial documented development baseline, matching the frontend and data package
versions. This entry summarizes the current project rather than reconstructing
untagged historical releases.

### Added

- Interactive graphs for exploring artists, cover performances, and original recordings.
- Offline generators for graph datasets, artist details, and artist and release artwork.
- Local SecondHandSongs API proxy with response caching and API monitoring tools.
- Separate Bruno collections for SecondHandSongs, Last.fm, MusicBrainz, and Discogs.
- API queries for artist metadata and relationships, recordings, release types,
	release editions, tracklists, and image sources.
- Rate-limited MusicBrainz and Discogs collection runners, dotenv-based credential
	loading where required, and API exploration documentation.

### Changed

- Upgraded the frontend to React 19.
- Refined graph layouts, artist selection, artwork presentation, and album chronology.
- Renamed the original API collection directory to `second-hand-songs-api-collection`
	and organized the other API collections as separate root-level directories.
