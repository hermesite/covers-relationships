#!/usr/bin/env python3
"""Generate band relation details for the frontend Band Detail page."""

from __future__ import annotations

import argparse
import os
import time
from pathlib import Path
from typing import Any

from generate_graph_data import (
    ANONYMOUS_RATE_LIMITS,
    SHS_API,
    ArtistTimeoutError,
    Context,
    FetchError,
    endpoint_from_uri,
    fetch_json,
    write_json,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate extended artist relation data for a band")
    parser.add_argument("--artist", type=int, default=14076, help="Band artist ID (default: 14076, The Cramps).")
    parser.add_argument("--no-cache", action="store_true", help="Fetch fresh API responses instead of using cached responses.")
    parser.add_argument("--output", default="frontend/data/band-detail", help="Output directory for generated JSON.")
    parser.add_argument(
        "--base-url",
        default=os.environ.get("SHS_BASE_URL", SHS_API),
        help="SecondHandSongs API base URL.",
    )
    parser.add_argument(
        "--artist-timeout-seconds",
        type=int,
        default=900,
        help="Hard timeout in seconds for all requests (set 0 to disable).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root_dir = Path(__file__).resolve().parent.parent
    output_dir = (root_dir / args.output).resolve()
    cache_dir = (root_dir / "data/.cache").resolve()
    ctx = Context(
        root_dir=root_dir,
        output_dir=output_dir,
        cache_dir=cache_dir,
        shs_cache_dir=(root_dir / "frontend/.shs-cache").resolve(),
        base_url=args.base_url,
        api_key=os.environ.get("SHS_API_KEY"),
        use_cache=not args.no_cache,
        rate_limit_file=cache_dir / "_sent.json",
        rate_limits=ANONYMOUS_RATE_LIMITS,
    )
    deadline = time.monotonic() + args.artist_timeout_seconds if args.artist_timeout_seconds > 0 else None

    try:
        band = fetch_json(ctx, f"/artist/{args.artist}", deadline=deadline)
    except (ArtistTimeoutError, FetchError) as exc:
        print(f"Unable to fetch artist {args.artist}: {exc}")
        return 1

    if band.get("entityType") != "artist" or band.get("entitySubType") != "group":
        print(f"Warning: artist {args.artist} is not identified as an artist group.")

    relations = band.get("relations")
    if not isinstance(relations, list):
        relations = []
    if not relations:
        print(f"Artist {args.artist} has no relations.")

    enriched_relations: list[dict[str, Any]] = []
    details_by_endpoint: dict[str, dict[str, Any]] = {}
    failures: list[str] = []

    for relation in relations:
        if not isinstance(relation, dict):
            continue

        artist_stub = relation.get("artist") if isinstance(relation.get("artist"), dict) else {}
        uri = artist_stub.get("uri") or relation.get("uri")
        endpoint = endpoint_from_uri(uri) if isinstance(uri, str) else None
        enriched_relation = dict(relation)
        name = artist_stub.get("commonName") or uri or "Unknown artist"

        if endpoint:
            try:
                if endpoint not in details_by_endpoint:
                    details_by_endpoint[endpoint] = fetch_json(ctx, endpoint, deadline=deadline)
                enriched_relation["artistDetails"] = details_by_endpoint[endpoint]
                person = details_by_endpoint[endpoint]
                print(
                    f"{relation.get('relationName', 'relation')}: "
                    f"{person.get('commonName') or name} "
                    f"({person.get('entitySubType', 'unknown subtype')})"
                )
            except (ArtistTimeoutError, FetchError) as exc:
                message = f"{name}: {exc}"
                enriched_relation["artistDetailsError"] = str(exc)
                failures.append(message)
                print(f"Unable to fetch relation artist {message}")
        else:
            print(f"Skipping relation without a SecondHandSongs artist URI: {name}")

        enriched_relations.append(enriched_relation)

    artist_summary = {key: value for key, value in band.items() if key != "relations"}
    output_path = output_dir / f"{args.artist}.json"
    write_json(output_path, {"artist": artist_summary, "relations": enriched_relations})
    print(f"Wrote {len(enriched_relations)} relation(s) to {output_path.relative_to(root_dir)}")

    if failures:
        print(f"Completed with {len(failures)} relation fetch failure(s).")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())