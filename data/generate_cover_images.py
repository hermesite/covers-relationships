#!/usr/bin/env python3
"""Enrich existing Covers and Originals graphs with artist and release images."""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.request import Request, urlopen

try:
    from .generate_graph_data import select_best_artist_picture, write_json, normalize_artist_search_name, _probe_image_url
    from .artwork_sources import discogs_image, musicbrainz_artist_image, musicbrainz_album_image
except ImportError:
    from generate_graph_data import select_best_artist_picture, write_json, normalize_artist_search_name, _probe_image_url
    from artwork_sources import discogs_image, musicbrainz_artist_image, musicbrainz_album_image

DEFAULT_MAX_ARTIST_LOOKUPS = 40
ImageResolver = Callable[..., tuple[Optional[str], list[dict[str, str]]]]


def save_release_artwork(uri: str, image_url: str) -> str | None:
    if image_url.startswith("/images/releases/"):
        return image_url
    try:
        request = Request(image_url, headers={"User-Agent": "SecondhandCovers/0.1 (artwork enrichment)"})
        with urlopen(request, timeout=20) as response:
            extensions = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}
            extension = extensions.get(response.headers.get_content_type())
            if extension is None:
                return None
            content = response.read()
        release_id = uri.rstrip("/").rsplit("/", 1)[-1]
        if not release_id.isdigit():
            return None
        asset_dir = Path(__file__).resolve().parent.parent / "frontend/data/images/releases"
        asset_dir.mkdir(parents=True, exist_ok=True)
        filename = release_id + extension
        (asset_dir / filename).write_bytes(content)
        return "/images/releases/" + filename
    except Exception:
        return None


def resolve_artist_images(raw_picture: str | None, artist_name: str, **options: Any) -> tuple[str | None, list[dict[str, str]]]:
    image, probes = select_best_artist_picture(raw_picture, artist_name, **options)
    if image:
        return image, probes
    search_name = normalize_artist_search_name(artist_name)
    for source, resolver in (("musicbrainz", musicbrainz_artist_image), ("discogs", discogs_image)):
        candidate = resolver(search_name)
        if not candidate:
            continue
        ok, status = _probe_image_url(candidate)
        probes.append({"source": source, "url": candidate, "ok": str(ok), "status": status})
        if ok:
            return candidate, probes
    return None, probes


def enrich_album_images(payload: dict[str, Any]) -> tuple[int, int]:
    artist = payload.get("artist") or {}
    artist_name = normalize_artist_search_name(artist.get("commonName") or artist.get("name") or "")
    albums: dict[str, list[dict[str, Any]]] = {}
    for item in payload.get("networkData") or []:
        data = item.get("data") or {}
        for release in data.get("coverReleases", data.get("releases")) or []:
            if release.get("uri") and release.get("title"):
                albums.setdefault(release["uri"], []).append(release)
    resolved = 0
    for references in albums.values():
        title = re.sub(r"\s+EP$", "", references[0]["title"], flags=re.IGNORECASE)
        image = next((release.get("imageUrl") for release in references if release.get("imageUrl")), None)
        is_local_release = references[0].get("entitySubType") in ("EP", "single")
        if is_local_release and image and not image.startswith("/") and not _probe_image_url(image)[0]:
            image = None
        if not image:
            for source, resolver in (("musicbrainz", musicbrainz_album_image), ("discogs", discogs_image)):
                candidate = resolver(artist_name, title)
                if candidate and _probe_image_url(candidate)[0]:
                    image = candidate
                    for release in references:
                        release["imageSource"] = source
                    break
        if is_local_release and image:
            image = save_release_artwork(references[0]["uri"], image)
        if is_local_release and not image:
            for release in references:
                release["imageUrl"] = None
        if image:
            resolved += 1
            for release in references:
                release["imageUrl"] = image
    payload.setdefault("diagnostics", {})["albumImageResolvedCount"] = resolved
    return resolved, len(albums)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Add artist and release images to Covers and Originals graphs")
    parser.add_argument("--artist", type=int, required=True, help="Artist ID whose graphs will be enriched.")
    parser.add_argument(
        "--output",
        default="frontend/data/graphs",
        help="Graph data directory containing covers/ and originals/ subdirectories.",
    )
    parser.add_argument(
        "--max-artists",
        type=int,
        default=DEFAULT_MAX_ARTIST_LOOKUPS,
        help="Maximum number of missing performer-image lookups per graph.",
    )
    return parser.parse_args(argv)


def enrich_payload(
    payload: dict[str, Any],
    artist_id: int,
    max_artists: int,
    image_resolver: ImageResolver = resolve_artist_images,
    include_selected_artist: bool = True,
) -> tuple[int, int]:
    artist = payload.get("artist") or {}
    artist_name = artist.get("commonName") or artist.get("name") or f"Artist {artist_id}"
    selected_picture = payload.get("artistPictureResolved")
    picture_probes = (payload.get("diagnostics") or {}).get("imageCandidates") or []
    if include_selected_artist and not payload.get("artistPictures"):
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
            if data.get("imageUrl"):
                seen[artist_uri] = data["imageUrl"]
            elif lookups >= max(max_artists, 0):
                seen[artist_uri] = None
            else:
                print(f"Artist image: {data.get('label')}", flush=True)
                image_url, _ = image_resolver(
                    None,
                    data.get("label") or "Unknown artist",
                    include_musicbrainz=False,
                    include_deezer=True,
                    probe_candidates=True,
                )
                seen[artist_uri] = image_url
                lookups += 1
                if image_url:
                    resolved += 1
        data["imageUrl"] = seen[artist_uri] or data.get("imageUrl")

    diagnostics = payload.setdefault("diagnostics", {})
    diagnostics["artistImageLookupCount"] = lookups
    diagnostics["artistImageResolvedCount"] = resolved
    if include_selected_artist:
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
    originals_path = (root_dir / args.output / "originals" / f"{args.artist}.json").resolve()
    originals_payload = json.loads(originals_path.read_text(encoding="utf-8")) if originals_path.exists() else None
    resolved, lookups = enrich_payload(payload, args.artist, args.max_artists)
    if originals_payload is not None:
        originals_resolved, originals_lookups = enrich_payload(
            originals_payload, args.artist, args.max_artists, include_selected_artist=False,
        )
        print(f"Original-song cover artists resolved: {originals_resolved}/{originals_lookups}", flush=True)
    combined_payload = {
        "artist": payload.get("artist"),
        "networkData": [*(payload.get("networkData") or []), *((originals_payload or {}).get("networkData") or [])],
    }
    album_resolved, album_total = enrich_album_images(combined_payload)
    for graph_payload in [payload, *([originals_payload] if originals_payload is not None else [])]:
        releases = {
            release["uri"]: release
            for item in graph_payload.get("networkData") or []
            for release in (item.get("data") or {}).get("coverReleases", (item.get("data") or {}).get("releases")) or []
            if release.get("uri")
        }
        graph_payload.setdefault("diagnostics", {})["albumImageResolvedCount"] = sum(bool(release.get("imageUrl")) for release in releases.values())

    write_json(covers_path, payload)
    if originals_payload is not None:
        write_json(originals_path, originals_payload)
        print(f"Images -> {originals_path.relative_to(root_dir)}")
    print(f"Images -> {covers_path.relative_to(root_dir)}")
    print(f"Cover artists resolved: {resolved}/{lookups}")
    print(f"Album artwork resolved: {album_resolved}/{album_total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))