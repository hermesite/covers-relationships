#!/usr/bin/env python3
"""Enrich an existing Covers graph with artist images."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

try:
    from .generate_graph_data import select_best_artist_picture, write_json
except ImportError:
    from generate_graph_data import select_best_artist_picture, write_json

DEFAULT_MAX_ARTIST_LOOKUPS = 40
ImageResolver = Callable[..., tuple[Optional[str], list[dict[str, str]]]]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Add artist images to a generated Covers graph")
    parser.add_argument("--artist", type=int, required=True, help="Artist ID whose Covers graph will be enriched.")
    parser.add_argument(
        "--output",
        default="frontend/data/graphs",
        help="Graph data directory containing covers/<artist_id>.json.",
    )
    parser.add_argument(
        "--max-artists",
        type=int,
        default=DEFAULT_MAX_ARTIST_LOOKUPS,
        help="Maximum number of cover-artist image lookups.",
    )
    return parser.parse_args(argv)


def enrich_payload(
    payload: dict[str, Any],
    artist_id: int,
    max_artists: int,
    image_resolver: ImageResolver = select_best_artist_picture,
) -> tuple[int, int]:
    artist = payload.get("artist") or {}
    artist_name = artist.get("commonName") or artist.get("name") or f"Artist {artist_id}"
    selected_picture, picture_probes = image_resolver(artist.get("picture"), artist_name)

    artist_nodes = [
        item
        for item in payload.get("networkData") or []
        if (item.get("data") or {}).get("nodeType") == "artist"
    ]
    lookups = 0
    resolved = 0
    seen: dict[str, str | None] = {}

    for item in artist_nodes:
        data = item.get("data") or {}
        artist_uri = data.get("id")
        if not artist_uri:
            continue
        if artist_uri not in seen:
            if lookups >= max(max_artists, 0):
                seen[artist_uri] = None
            else:
                image_url, _ = image_resolver(
                    None,
                    data.get("label") or "Unknown artist",
                    include_musicbrainz=False,
                    include_deezer=True,
                    probe_candidates=False,
                )
                seen[artist_uri] = image_url
                lookups += 1
                if image_url:
                    resolved += 1
        data["imageUrl"] = seen[artist_uri]

    diagnostics = payload.setdefault("diagnostics", {})
    diagnostics["artistImageLookupCount"] = lookups
    diagnostics["artistImageResolvedCount"] = resolved
    diagnostics["imageCandidates"] = picture_probes
    payload["artistPictureResolved"] = selected_picture
    payload["artistPictures"] = list(
        dict.fromkeys(
            probe["url"]
            for probe in picture_probes
            if probe.get("ok") == "True" and probe.get("url")
        )
    )
    payload["imagesGeneratedAt"] = datetime.now(timezone.utc).isoformat()
    return resolved, lookups


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    root_dir = Path(__file__).resolve().parent.parent
    covers_path = (root_dir / args.output / "covers" / f"{args.artist}.json").resolve()

    if not covers_path.exists():
        print(f"Covers data not found: {covers_path}", file=sys.stderr)
        print("Generate performance data before retrieving images.", file=sys.stderr)
        return 1

    payload: dict[str, Any] = json.loads(covers_path.read_text(encoding="utf-8"))
    resolved, lookups = enrich_payload(payload, args.artist, args.max_artists)

    write_json(covers_path, payload)
    print(f"Images -> {covers_path.relative_to(root_dir)}")
    print(f"Cover artists resolved: {resolved}/{lookups}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))