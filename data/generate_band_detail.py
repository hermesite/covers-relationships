#!/usr/bin/env python3
"""Generate MusicBrainz relationships and tags for the Band Detail page."""

from __future__ import annotations

import argparse
import json
import os
import re
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from uuid import UUID

from band_members import build_band_family_network, enrich_member_details, enrich_memberships, membership_match, profile_memberships
from band_releases import discogs_release_annotations, release_annotations
from generate_graph_data import write_json

CRAMPS_MBID = "96c1edac-1011-4cb8-882c-27248de35071"
RELATION_TARGETS = (
    "artist", "label", "recording", "release", "release-group", "work",
    "area", "place", "event", "series", "instrument", "url",
)
LAST_REQUEST: dict[str, float] = {}


def fetch_cached(url: str, cache_path: Path, args: argparse.Namespace) -> dict:
    if not args.no_cache and cache_path.exists():
        return json.loads(cache_path.read_text(encoding="utf-8"))
    host = "discogs" if url.startswith("https://api.discogs.com/") else "musicbrainz"
    wait = 1.1 - (time.monotonic() - LAST_REQUEST.get(host, 0))
    if wait > 0:
        time.sleep(wait)
    headers = {"Accept": "application/json", "User-Agent": "CoversRelationships/1.0 (band detail enrichment)"}
    if host == "discogs" and os.environ.get("DISCOGS_TOKEN"):
        headers["Authorization"] = "Discogs token=" + os.environ["DISCOGS_TOKEN"]
    LAST_REQUEST[host] = time.monotonic()
    with urlopen(Request(url, headers=headers), timeout=args.artist_timeout_seconds or None) as response:
        payload = json.load(response)
    if not isinstance(payload, dict):
        raise ValueError(f"Unexpected {host} response")
    write_json(cache_path, payload)
    return payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate MusicBrainz band relationships and tags")
    parser.add_argument("--artist", type=int, default=14076, help="App artist ID used for the output filename.")
    parser.add_argument("--mbid", type=UUID, help="MusicBrainz artist ID (defaults to The Cramps for artist 14076).")
    parser.add_argument("--discogs-id", type=int, help="Discogs artist ID (otherwise resolved from MusicBrainz links).")
    parser.add_argument("--skip-discogs", action="store_true", help="Generate MusicBrainz-only membership data.")
    parser.add_argument("--skip-member-details", action="store_true", help="Skip member profile, relationship and portrait lookups.")
    parser.add_argument("--skip-releases", action="store_true", help="Skip discography and recording annotation lookups.")
    parser.add_argument("--no-cache", action="store_true", help="Fetch fresh source data.")
    parser.add_argument("--output", default="frontend/data/band-detail", help="Output directory for generated JSON.")
    parser.add_argument("--artist-timeout-seconds", type=int, default=60, help="Request timeout (0 disables it).")
    args = parser.parse_args()
    if args.mbid is None:
        if args.artist != 14076:
            parser.error("--mbid is required for artists other than The Cramps (14076)")
        args.mbid = UUID(CRAMPS_MBID)
    if args.artist_timeout_seconds < 0:
        parser.error("--artist-timeout-seconds must be nonnegative")
    if args.discogs_id is not None and args.discogs_id <= 0:
        parser.error("--discogs-id must be positive")
    return args


def main() -> int:
    args = parse_args()
    root_dir = Path(__file__).resolve().parent.parent
    artist_url = f"https://musicbrainz.org/artist/{args.mbid}"
    includes = [f"{target}-rels" for target in RELATION_TARGETS] + ["tags", "genres", "aliases"]
    api_url = f"https://musicbrainz.org/ws/2/artist/{args.mbid}?" + urlencode({
        "inc": "+".join(includes), "fmt": "json",
    })
    cache_path = root_dir / "data/.cache/band-detail" / f"{args.mbid}.json"
    try:
        band = fetch_cached(api_url, cache_path, args)
        if not isinstance(band, dict) or band.get("id") != str(args.mbid):
            raise ValueError("MusicBrainz returned an unexpected artist response")
    except (HTTPError, URLError, TimeoutError, OSError, ValueError) as exc:
        print(f"Unable to fetch MusicBrainz artist {args.mbid}: {exc}")
        return 1

    relations = band.get("relations", [])
    memberships = [relation for relation in relations if relation.get("type") == "member of band"
                   and relation.get("direction") == "backward"]
    discogs_id = args.discogs_id
    if discogs_id is None:
        for relation in relations:
            match = re.match(r"https?://(?:www\.)?discogs\.com/(?:[a-z]{2}/)?artist/(\d+)", relation.get("url", {}).get("resource", ""))
            if match:
                discogs_id = int(match.group(1))
                break
    enrichment = {"status": "disabled" if args.skip_discogs else "not-linked"}
    discogs = {}
    if discogs_id and not args.skip_discogs:
        try:
            discogs = fetch_cached(f"https://api.discogs.com/artists/{discogs_id}", cache_path.parent / f"discogs-{discogs_id}.json", args)
            if discogs.get("id") != discogs_id:
                raise ValueError("Discogs returned an unexpected artist")
            entries = profile_memberships(discogs)
            if not entries:
                raise ValueError("No explicit member periods found in the Discogs profile")
            identities = {}
            people = {relation["artist"]["id"]: relation["artist"] for relation in memberships}
            for person in people.values():
                if any(membership_match(entry, person, discogs, {}) for entry in entries):
                    continue
                detail_url = f"https://musicbrainz.org/ws/2/artist/{person['id']}?inc=url-rels&fmt=json"
                details = fetch_cached(detail_url, cache_path.parent / f"member-{person['id']}.json", args)
                for relation in details.get("relations", []):
                    match = re.match(r"https?://(?:www\.)?discogs\.com/artist/(\d+)", relation.get("url", {}).get("resource", ""))
                    if match:
                        identities[person["id"]] = int(match.group(1))
            memberships = enrich_memberships(band, discogs, identities)
            enrichment = {"status": "complete", "name": "Discogs", "url": f"https://www.discogs.com/artist/{discogs_id}"}
            print(f"Enriched {len(memberships)} membership period(s) with Discogs profile evidence.")
        except (HTTPError, URLError, TimeoutError, OSError, ValueError) as exc:
            enrichment = {"status": "unavailable", "error": str(exc)}
            print(f"Warning: Discogs enrichment unavailable; keeping MusicBrainz memberships: {exc}")
    member_details = []
    if not args.skip_member_details:
        member_details = enrich_member_details(
            band, memberships, discogs,
            lambda url, key: fetch_cached(url, cache_path.parent / f"{key}.json", args),
            root_dir / "frontend/data/images/members",
            use_discogs=not args.skip_discogs,
        )
    band_family_network = build_band_family_network(
        band,
        memberships,
        member_details,
        discogs,
        lambda url, key: fetch_cached(url, cache_path.parent / f"{key}.json", args),
    )
    print(f"Fetched rosters for {band_family_network['groupsFetched']}/{band_family_network['groupCount']} connected bands.")
    releases = {"status": "disabled", "items": []}
    if not args.skip_releases:
        try:
            release_fetch = lambda url, key: fetch_cached(url, cache_path.parent / f"{key}.json", args)
            releases = discogs_release_annotations(discogs_id, release_fetch) if discogs_id and not args.skip_discogs else release_annotations(str(args.mbid), release_fetch)
            print(f"Fetched {len(releases['items'])} {releases['source']} discography annotations.")
        except (HTTPError, URLError, TimeoutError, OSError, ValueError) as exc:
            releases = {"status": "unavailable", "items": [], "error": str(exc)}
            print(f"Warning: release annotations unavailable: {exc}")
    tags = sorted(band.get("tags", []), key=lambda tag: (-tag.get("count", 0), tag["name"]))
    output_path = (root_dir / args.output).resolve() / f"{args.artist}.json"
    write_json(output_path, {
        "source": {
            "name": "MusicBrainz",
            "artistUrl": artist_url,
            "relationshipsUrl": f"{artist_url}/relationships",
            "tagsUrl": f"{artist_url}/tags",
        },
        "artist": {key: value for key, value in band.items() if key not in ("relations", "tags", "genres")},
        "relations": relations,
        "memberships": memberships,
        "membershipEnrichment": enrichment,
        "memberDetails": member_details,
        "bandFamilyNetwork": band_family_network,
        "releaseAnnotations": releases,
        "tags": tags,
        "genres": band.get("genres", []),
    })
    print(f"Wrote {len(relations)} MusicBrainz relationships and {len(tags)} tags to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())