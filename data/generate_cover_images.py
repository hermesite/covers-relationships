#!/usr/bin/env python3
"""Enrich existing Covers and Originals graphs with artist and release images."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.request import Request, urlopen

try:
    from .generate_graph_data import select_best_artist_picture, write_json, normalize_artist_search_name, _probe_image_url
    from .artwork_sources import discogs_image, discogs_artist_images, discogs_release_image, musicbrainz_artist_image, musicbrainz_album_image, match_key
except ImportError:
    from generate_graph_data import select_best_artist_picture, write_json, normalize_artist_search_name, _probe_image_url
    from artwork_sources import discogs_image, discogs_artist_images, discogs_release_image, musicbrainz_artist_image, musicbrainz_album_image, match_key

DEFAULT_MAX_ARTIST_LOOKUPS = 40
ImageResolver = Callable[..., tuple[Optional[str], list[dict[str, str]]]]


def save_release_artwork(uri: str, image_url: str, asset_kind: str = "releases", asset_tag: str | None = None) -> str | None:
    if asset_kind not in ("releases", "artists"):
        return None
    if image_url.startswith(f"/images/{asset_kind}/"):
        asset = Path(__file__).resolve().parent.parent / "frontend/data" / image_url.lstrip("/")
        return image_url if asset.is_file() and asset.stat().st_size > 0 else None
    try:
        request = Request(image_url, headers={"User-Agent": "SecondhandCovers/0.1 (artwork enrichment)"})
        with urlopen(request, timeout=20) as response:
            extensions = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}
            extension = extensions.get(response.headers.get_content_type())
            if extension is None:
                return None
            content = response.read()
        release_id = uri.rstrip("/").rsplit("/", 1)[-1]
        if not re.fullmatch(r"\d+(?:\+\d+)*", release_id):
            return None
        asset_dir = Path(__file__).resolve().parent.parent / "frontend/data/images" / asset_kind
        asset_dir.mkdir(parents=True, exist_ok=True)
        if asset_tag and not re.fullmatch(r"[a-f0-9]{12}", asset_tag):
            return None
        filename = release_id + ("-" + asset_tag if asset_tag else "") + extension
        (asset_dir / filename).write_bytes(content)
        return f"/images/{asset_kind}/" + filename
    except Exception:
        return None


def enrich_discogs_artists(payload: dict[str, Any], max_artists: int, refresh: bool = False, preserve_curated: bool = False) -> tuple[int, int]:
    lookups = 0
    resolved = 0
    results: dict[str, dict[str, str]] = {}
    for item in payload.get("networkData") or []:
        data = item.get("data") or {}
        if data.get("nodeType") != "artist" or not data.get("id"):
            continue
        artist_uri = data["id"]
        if artist_uri in results:
            data.update(results[artist_uri])
            continue
        if preserve_curated and data.get("imageSource") == "discogs" and data.get("discogsArtistId") and data.get("imageUrl"):
            if save_release_artwork(artist_uri, data["imageUrl"], asset_kind="artists"):
                continue
        if data.get("imageUrl") and not refresh:
            continue
        if lookups >= max_artists:
            continue
        lookups += 1
        name = normalize_artist_search_name(data.get("label") or "")
        lead_name = re.split(r"\s+(?:with|and|&)\s+", name, maxsplit=1, flags=re.IGNORECASE)[0]
        candidates = list(dict.fromkeys([name, lead_name]))
        for credit in candidates:
            image = discogs_image(credit)
            if not image:
                continue
            local_image = save_release_artwork(artist_uri, image, asset_kind="artists")
            if not local_image:
                continue
            results[artist_uri] = {
                "imageUrl": local_image,
                "imageSource": "discogs",
                "imageCredit": credit,
                "imageSourceUrl": image,
            }
            data.update(results[artist_uri])
            resolved += 1
            break
        print(f"Discogs artist: {name}; {'saved' if artist_uri in results else 'unresolved'}", flush=True)
    payload.setdefault("diagnostics", {})["discogsArtistImageLookupCount"] = lookups
    payload["diagnostics"]["discogsArtistImageResolvedCount"] = resolved
    payload["imagesGeneratedAt"] = datetime.now(timezone.utc).isoformat()
    return resolved, lookups


def enrich_discogs_selected_artist(payload: dict[str, Any]) -> bool:
    artist = payload.get("artist") or {}
    name = normalize_artist_search_name(artist.get("commonName") or artist.get("name") or "")
    uri = artist.get("uri") or f"https://api.secondhandsongs.com/artist/{artist.get('id')}"
    image = discogs_image(name)
    if not image:
        return False
    tag = hashlib.sha256(image.encode()).hexdigest()[:12]
    local_image = save_release_artwork(uri, image, asset_kind="artists", asset_tag=tag)
    if not local_image:
        return False
    payload["artistPictureResolved"] = local_image
    payload["artistPictureSource"] = "discogs"
    payload["artistPictureSourceUrl"] = image
    payload["artistPictures"] = list(dict.fromkeys([local_image, *(payload.get("artistPictures") or [])]))
    candidates = payload.setdefault("diagnostics", {}).setdefault("imageCandidates", [])
    candidates[:] = [candidate for candidate in candidates if candidate.get("source") != "discogs.selected"]
    candidates.insert(0, {"source": "discogs.selected", "url": local_image, "ok": "True", "status": "downloaded"})
    payload["imagesGeneratedAt"] = datetime.now(timezone.utc).isoformat()
    return True


def update_named_artist_image(graphs: list[tuple[Path, dict[str, Any]]], args: argparse.Namespace) -> int:
    if not os.environ.get("DISCOGS_TOKEN"):
        print("DISCOGS_TOKEN is required for Discogs image searches.", file=sys.stderr)
        return 1
    search_name = normalize_artist_search_name(args.artist_name)
    matches = []
    for graph_path, payload in graphs:
        for item in payload.get("networkData") or []:
            data = item.get("data") or {}
            if data.get("nodeType") != "artist" or not data.get("id"):
                continue
            names = [normalize_artist_search_name(data.get("label") or ""), data.get("imageCredit") or ""]
            selected = data["id"] == args.node_uri if args.node_uri else any(
                match_key(name) == match_key(search_name) for name in names
            )
            if selected:
                matches.append((graph_path, payload, data))
    if not matches and not args.list_images:
        print(f"No graph artist matches {args.artist_name!r}; use its graph label or recorded image credit.", file=sys.stderr)
        return 1
    if not args.list_images and len({data["id"] for _, _, data in matches}) > 1:
        print("Multiple graph artists match; specify --node-uri to select the intended node.", file=sys.stderr)
        return 1
    try:
        images = discogs_artist_images(search_name, args.discogs_id)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1
    if not images:
        print("No Discogs artist images found; graph files unchanged.", file=sys.stderr)
        return 1
    print(f"Discogs artist: {images[0]['artistName']} (ID {images[0]['artistId']})")
    for index, image in enumerate(images, start=1):
        print(f"{index}: {image['type']} {image['width']}x{image['height']} {image['url']}")
    if args.list_images:
        return 0
    if args.image_index is not None:
        if not 1 <= args.image_index <= len(images):
            print(f"--image-index must be between 1 and {len(images)}; graph files unchanged.", file=sys.stderr)
            return 1
        image = images[args.image_index - 1]
    else:
        current_urls = {data.get("imageSourceUrl") for _, _, data in matches}
        alternatives = sorted(images, key=lambda candidate: candidate["type"] != "secondary")
        image = next((candidate for candidate in alternatives if candidate["url"] not in current_urls), None)
        if image is None:
            print("No different Discogs image available; graph files unchanged.", file=sys.stderr)
            return 1
    data = matches[0][2]
    tag = hashlib.sha256(image["url"].encode()).hexdigest()[:12]
    local_image = save_release_artwork(data["id"], image["url"], asset_kind="artists", asset_tag=tag)
    if not local_image:
        print("Selected image could not be downloaded; graph files unchanged.", file=sys.stderr)
        return 1
    updated_paths = set()
    for graph_path, payload, data in matches:
        data.update({"imageUrl": local_image, "imageSource": "discogs", "imageSourceUrl": image["url"],
                     "imageCredit": image["artistName"], "discogsArtistId": image["artistId"], "imageProfileUrl": image["profileUrl"]})
        payload["imagesGeneratedAt"] = datetime.now(timezone.utc).isoformat()
        updated_paths.add(graph_path)
    for graph_path, payload in graphs:
        if graph_path in updated_paths:
            write_json(graph_path, payload)
    print(f"Updated {args.artist_name}: {local_image} in {len(updated_paths)} graph file(s).")
    return 0


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
    tracks_by_release: dict[str, list[str]] = {}
    for item in payload.get("networkData") or []:
        data = item.get("data") or {}
        for release in data.get("coverReleases", data.get("releases")) or []:
            if release.get("uri") and release.get("title"):
                albums.setdefault(release["uri"], []).append(release)
                if data.get("label"):
                    tracks_by_release.setdefault(release["uri"], []).append(data["label"])
    resolved = 0
    for references in albums.values():
        title = re.sub(r"\s+EP$", "", references[0]["title"], flags=re.IGNORECASE)
        image = next((release.get("imageUrl") for release in references if release.get("imageUrl")), None)
        source_image = image
        if image:
            image = save_release_artwork(references[0]["uri"], image)
        if not image:
            for source, resolver in (("musicbrainz", musicbrainz_album_image), ("discogs", discogs_image)):
                candidate = resolver(artist_name, title)
                local_image = save_release_artwork(references[0]["uri"], candidate) if candidate else None
                if local_image:
                    image = local_image
                    source_image = candidate
                    for release in references:
                        release["imageSource"] = source
                    break
        if not image:
            candidate = discogs_release_image(artist_name, title, tracks_by_release.get(references[0]["uri"], []))
            local_image = save_release_artwork(references[0]["uri"], candidate) if candidate else None
            if local_image:
                image = local_image
                source_image = candidate
                for release in references:
                    release["imageSource"] = "discogs"
                    release["imageMatch"] = "credited-track"
        if image:
            resolved += 1
        for release in references:
            release["imageUrl"] = image
            if image and source_image and not source_image.startswith("/"):
                release["imageSourceUrl"] = source_image
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
    parser.add_argument("--discogs-artists-only", action="store_true", help="Use Discogs for artist nodes only; preserve performances and releases.")
    parser.add_argument("--discogs-first", action="store_true", help="Prefer Discogs for artist portraits and the central node; retain fallbacks and manually selected Discogs images.")
    parser.add_argument("--releases-only", action="store_true", help="Validate and retrieve release artwork without looking up artist images.")
    parser.add_argument("--graph", choices=("covers", "originals", "both"), default="both", help="Graph source for Discogs-only enrichment; defaults to both sources shown in Covers.")
    parser.add_argument("--refresh-artists", action="store_true", help="Also replace existing artist images when Discogs returns a downloadable match.")
    parser.add_argument("--artist-name", help="Search Discogs for an alternative image for this graph artist name.")
    parser.add_argument("--alternative-image", action="store_true", help="Require targeted artist-name mode instead of bulk enrichment.")
    parser.add_argument("--discogs-id", type=int, help="Select a specific Discogs artist record when names are ambiguous.")
    parser.add_argument("--image-index", type=int, help="Select an image from the numbered Discogs gallery (1-based).")
    parser.add_argument("--list-images", action="store_true", help="List alternatives without changing graph data.")
    parser.add_argument("--node-uri", help="Select a graph artist URI when several graph nodes have the same normalized name.")
    args = parser.parse_args(argv)
    if args.discogs_first:
        args.discogs_artists_only = True
        args.refresh_artists = True
    if args.alternative_image and not args.artist_name:
        parser.error("--artist-name is required for alternative image searches")
    if args.discogs_artists_only and args.releases_only:
        parser.error("--discogs-artists-only and --releases-only cannot be combined")
    if args.artist_name and (args.discogs_artists_only or args.releases_only or args.refresh_artists):
        parser.error("--artist-name cannot be combined with bulk enrichment options")
    if not args.artist_name and (args.discogs_id or args.image_index is not None or args.list_images or args.node_uri):
        parser.error("Artist gallery options require --artist-name")
    return args


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
    if args.artist_name:
        graphs = [
            (graph_path, graph_payload)
            for graph_name, graph_path, graph_payload in (
                ("covers", covers_path, payload), ("originals", originals_path, originals_payload),
            )
            if graph_payload is not None and args.graph in (graph_name, "both")
        ]
        return update_named_artist_image(graphs, args)
    if args.discogs_artists_only:
        if not os.environ.get("DISCOGS_TOKEN"):
            print("DISCOGS_TOKEN is required for Discogs artist enrichment.", file=sys.stderr)
            return 1
        if args.graph == "originals" and originals_payload is None:
            print(f"Originals data not found: {originals_path}", file=sys.stderr)
            return 1
        for graph_name, graph_path, graph_payload in (
            ("covers", covers_path, payload), ("originals", originals_path, originals_payload),
        ):
            if graph_payload is None or args.graph not in (graph_name, "both"):
                continue
            if args.discogs_first:
                central_resolved = enrich_discogs_selected_artist(graph_payload)
                print(f"{graph_name}: central Discogs portrait {'saved' if central_resolved else 'unavailable; existing image retained'}")
            resolved, lookups = enrich_discogs_artists(
                graph_payload, args.max_artists, args.refresh_artists, preserve_curated=args.discogs_first,
            )
            write_json(graph_path, graph_payload)
            print(f"{graph_name}: Discogs artist images saved: {resolved}/{lookups}")
        return 0
    resolved, lookups = (0, 0) if args.releases_only else enrich_payload(payload, args.artist, args.max_artists)
    if originals_payload is not None and not args.releases_only:
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