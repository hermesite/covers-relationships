#!/usr/bin/env python3
"""Generate precomputed graph datasets for Covers and Originals pages.

Outputs JSON files to:
    frontend/data/graphs/covers/<artist_id>.json
    frontend/data/graphs/originals/<artist_id>.json
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

SHS_API = "https://api.secondhandsongs.com"
MB_API = "https://musicbrainz.org/ws/2"
WIKIDATA_ENTITY = "https://www.wikidata.org/wiki/Special:EntityData"
DEEZER_SEARCH = "https://api.deezer.com/search/artist"
ARTIST_OPTIONS = [
    {"id": 14076, "name": "The Cramps"}
]

MAX_PERFORMANCE_REQUESTS = 80
MAX_ORIGINAL_REQUESTS = 80
MAX_COVER_ARTIST_IMAGE_LOOKUPS = 40
REQUEST_PAUSE_SECONDS = 0.08
RETRY_BACKOFF_SECONDS = 2.0
MAX_RETRIES = 5
DEFAULT_ARTIST_TIMEOUT_SECONDS = 180


@dataclass
class Context:
    root_dir: Path
    output_dir: Path
    cache_dir: Path
    shs_cache_dir: Path
    base_url: str
    api_key: str | None
    use_cache: bool


class FetchError(RuntimeError):
    pass


class ArtistTimeoutError(RuntimeError):
    pass


def trace(scope: str, message: str) -> None:
    print(f"  [trace:{scope}] {message}")


def _safe_filename(endpoint: str) -> str:
    return re.sub(r"[^\w.-]+", "_", endpoint).lstrip("_") + ".json"


def _cache_file(ctx: Context, endpoint: str) -> Path:
    return ctx.cache_dir / _safe_filename(endpoint)


def _shs_cache_file(ctx: Context, endpoint: str) -> Path:
    return ctx.shs_cache_dir / _safe_filename(endpoint)


def _request_json(url: str, api_key: str | None, timeout_seconds: float = 30.0) -> Any:
    headers = {
        "Accept": "application/json",
        "User-Agent": "secondhand-covers-data-generator/1.0",
    }
    if api_key:
        headers["X-API-Key"] = api_key
    request = Request(url, headers=headers)
    with urlopen(request, timeout=timeout_seconds) as response:
        payload = response.read().decode("utf-8")
        return json.loads(payload)


def _remaining_seconds(deadline: float | None) -> float | None:
    if deadline is None:
        return None
    return deadline - time.monotonic()


def fetch_json(ctx: Context, endpoint: str, deadline: float | None = None) -> Any:
    if not endpoint.startswith("/"):
        raise ValueError(f"endpoint must start with '/': {endpoint}")

    cache_file = _cache_file(ctx, endpoint)
    shs_cache_file = _shs_cache_file(ctx, endpoint)
    if ctx.use_cache:
        if cache_file.exists():
            return json.loads(cache_file.read_text(encoding="utf-8"))
        if shs_cache_file.exists():
            return json.loads(shs_cache_file.read_text(encoding="utf-8"))

    url = ctx.base_url.rstrip("/") + endpoint
    for attempt in range(1, MAX_RETRIES + 1):
        remaining = _remaining_seconds(deadline)
        if remaining is not None and remaining <= 0:
            raise ArtistTimeoutError(f"artist timeout reached before fetching {endpoint}")
        try:
            request_timeout = 30.0
            if remaining is not None:
                request_timeout = max(1.0, min(30.0, remaining))
            data = _request_json(url, ctx.api_key, timeout_seconds=request_timeout)
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            cache_file.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            if REQUEST_PAUSE_SECONDS > 0:
                remaining = _remaining_seconds(deadline)
                if remaining is not None and remaining <= 0:
                    raise ArtistTimeoutError(f"artist timeout reached after fetching {endpoint}")
                time.sleep(REQUEST_PAUSE_SECONDS)
            return data
        except HTTPError as exc:
            if exc.code in (429, 500, 502, 503, 504) and attempt < MAX_RETRIES:
                time.sleep(RETRY_BACKOFF_SECONDS * attempt)
                continue
            raise FetchError(f"HTTP {exc.code} for {endpoint}") from exc
        except URLError as exc:
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_BACKOFF_SECONDS * attempt)
                continue
            raise FetchError(f"Network error for {endpoint}: {exc}") from exc
        except json.JSONDecodeError as exc:
            raise FetchError(f"Invalid JSON from {endpoint}") from exc

    raise FetchError(f"Failed to fetch {endpoint}")


def endpoint_from_uri(uri: str) -> str | None:
    if not uri:
        return None
    if uri.startswith(SHS_API):
        return uri[len(SHS_API) :]
    if uri.startswith("/"):
        return uri
    return None


def fetch_many(
    ctx: Context,
    endpoints: list[str],
    deadline: float | None = None,
) -> tuple[list[Any], int, list[str]]:
    results: list[Any] = []
    failed = 0
    errors: list[str] = []
    for index, endpoint in enumerate(endpoints):
        remaining = _remaining_seconds(deadline)
        if remaining is not None and remaining <= 0:
            skipped = len(endpoints) - index
            failed += skipped
            errors.append(f"artist timeout reached, skipped remaining endpoints: {skipped}")
            break
        try:
            results.append(fetch_json(ctx, endpoint, deadline=deadline))
        except FetchError as exc:
            failed += 1
            errors.append(f"{endpoint}: {exc}")
        except ArtistTimeoutError as exc:
            skipped = len(endpoints) - index
            failed += skipped
            errors.append(str(exc))
            errors.append(f"artist timeout reached, skipped remaining endpoints: {skipped}")
            break
    return results, failed, errors


def linear_scale(value: float, dmin: float, dmax: float, rmin: float, rmax: float) -> float:
    if dmax <= dmin:
        return (rmin + rmax) / 2.0
    t = (value - dmin) / (dmax - dmin)
    return rmin + t * (rmax - rmin)


def log_scale(value: float, dmin: float, dmax: float, rmin: float, rmax: float) -> float:
    value = max(value, dmin)
    if dmax <= dmin:
        return (rmin + rmax) / 2.0
    t = (math.log(value) - math.log(dmin)) / (math.log(dmax) - math.log(dmin))
    return rmin + t * (rmax - rmin)


def deburr(text: str) -> str:
    normalized = unicodedata.normalize("NFD", text)
    return "".join(c for c in normalized if unicodedata.category(c) != "Mn")


def dedupe_network_data(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for item in items:
        data = item.get("data", {})
        key = data.get("id") or f"{data.get('source')}->{data.get('target')}"
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def resolve_artist_picture_url(raw_url: str | None) -> str | None:
    if not raw_url:
        return None
    normalized = raw_url.replace('\\/', '/')
    if normalized.startswith('https://api.secondhandsongs.com/picture/'):
        return normalized.replace('https://api.secondhandsongs.com', 'https://secondhandsongs.com')
    return normalized


def _http_json_public(url: str, timeout_seconds: float = 12.0) -> Any:
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "covers-network-image-resolver/1.0",
        },
    )
    with urlopen(request, timeout=timeout_seconds) as response:
        payload = response.read().decode("utf-8")
        return json.loads(payload)


def _probe_image_url(url: str | None, timeout_seconds: float = 8.0) -> tuple[bool, str]:
    if not url:
        return False, "empty"
    try:
        req = Request(url, method="HEAD", headers={"User-Agent": "covers-network-image-resolver/1.0"})
        with urlopen(req, timeout=timeout_seconds) as response:
            return 200 <= response.status < 300, f"HEAD {response.status}"
    except Exception:
        pass

    try:
        req = Request(url, headers={"User-Agent": "covers-network-image-resolver/1.0"})
        with urlopen(req, timeout=timeout_seconds) as response:
            return 200 <= response.status < 300, f"GET {response.status}"
    except HTTPError as exc:
        return False, f"HTTP {exc.code}"
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)


def _commons_image_url(filename: str) -> str:
    import hashlib

    safe_name = filename.replace(" ", "_")
    md5 = hashlib.md5(safe_name.encode("utf-8")).hexdigest()
    return f"https://upload.wikimedia.org/wikipedia/commons/{md5[0]}/{md5[0:2]}/{quote(safe_name)}"


def _musicbrainz_wikidata_image(artist_name: str) -> str | None:
    try:
        search = _http_json_public(f"{MB_API}/artist/?query=artist:{quote(artist_name)}&fmt=json")
        artists = search.get("artists", [])
        if not artists:
            return None
        mbid = artists[0].get("id")
        if not mbid:
            return None
        details = _http_json_public(f"{MB_API}/artist/{mbid}?inc=url-rels&fmt=json")
        wikidata = None
        for rel in details.get("relations", []):
            if rel.get("type") == "wikidata":
                wikidata = (rel.get("url") or {}).get("resource")
                break
        if not wikidata or "/wiki/" not in wikidata:
            return None
        qid = wikidata.rsplit("/", 1)[-1]
        entity = _http_json_public(f"{WIKIDATA_ENTITY}/{qid}.json")
        claims = (((entity.get("entities") or {}).get(qid) or {}).get("claims") or {})
        p18 = claims.get("P18", [])
        if not p18:
            return None
        filename = (((p18[0].get("mainsnak") or {}).get("datavalue") or {}).get("value"))
        if not filename:
            return None
        return _commons_image_url(filename)
    except Exception:
        return None


def _deezer_image(artist_name: str, timeout_seconds: float = 8.0) -> str | None:
    try:
        data = _http_json_public(f"{DEEZER_SEARCH}?q={quote(artist_name)}", timeout_seconds=timeout_seconds)
        items = data.get("data", [])
        if not items:
            return None
        top = items[0]
        return top.get("picture_xl") or top.get("picture_medium") or top.get("picture")
    except Exception:
        return None


def select_best_artist_picture(
    raw_picture: str | None,
    artist_name: str,
    include_musicbrainz: bool = True,
    include_deezer: bool = True,
    probe_candidates: bool = True,
) -> tuple[str | None, list[dict[str, str]]]:
    candidates: list[dict[str, str]] = []

    resolved_raw = resolve_artist_picture_url(raw_picture)
    if raw_picture:
        candidates.append({"source": "shs.raw", "url": raw_picture})
    if resolved_raw and resolved_raw != raw_picture:
        candidates.append({"source": "shs.resolved", "url": resolved_raw})

    if include_musicbrainz:
        wikidata_url = _musicbrainz_wikidata_image(artist_name)
        if wikidata_url:
            candidates.append({"source": "wikidata", "url": wikidata_url})

    if include_deezer:
        deezer_url = _deezer_image(artist_name, timeout_seconds=5.0)
        if deezer_url:
            candidates.append({"source": "deezer", "url": deezer_url})

    probes: list[dict[str, str]] = []
    for candidate in candidates:
        if not probe_candidates:
            probes.append({"source": candidate["source"], "url": candidate["url"], "status": "not-probed", "ok": "unknown"})
            return candidate["url"], probes
        ok, status = _probe_image_url(candidate["url"])
        probes.append({"source": candidate["source"], "url": candidate["url"], "status": status, "ok": str(ok)})
        if ok:
            return candidate["url"], probes

    return resolved_raw or raw_picture, probes


def sorted_cover_list(original_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for original in original_items:
        covers = original.get("covers") or []
        original["covers"] = sorted(
            covers,
            key=lambda c: ((c.get("performer") or {}).get("name") or "").lower(),
        )
    return sorted(original_items, key=lambda o: len(o.get("covers") or []), reverse=True)


def generate_covers_data(ctx: Context, artist_id: int, deadline: float | None = None) -> dict[str, Any]:
    artist = fetch_json(ctx, f"/artist/{artist_id}", deadline=deadline)
    artist_picture, picture_probes = select_best_artist_picture(
        artist.get("picture"),
        artist.get("commonName") or artist.get("name") or f"Artist {artist_id}",
    )
    trace("covers", f"artist={artist_id} selected_picture={artist_picture}")
    performances = fetch_json(ctx, f"/artist/{artist_id}/performances", deadline=deadline)

    performance_uris = []
    for item in performances:
        endpoint = endpoint_from_uri(item.get("uri"))
        if endpoint:
            performance_uris.append(endpoint)
    performance_uris = list(dict.fromkeys(performance_uris))

    selected_performance_uris = performance_uris[:MAX_PERFORMANCE_REQUESTS]
    partial_data = len(performance_uris) > len(selected_performance_uris)
    trace("covers", f"artist={artist_id} performance_uris total={len(performance_uris)} selected={len(selected_performance_uris)}")

    performance_results, failed_performance_requests, performance_errors = fetch_many(
        ctx,
        selected_performance_uris,
        deadline=deadline,
    )
    if failed_performance_requests:
        partial_data = True
    trace("covers", f"artist={artist_id} performance_results ok={len(performance_results)} failed={failed_performance_requests}")

    covers = [
        p
        for p in performance_results
        if not p.get("isOriginal") and isinstance(p.get("originals"), list) and p.get("originals")
    ]

    cover_original_uris: list[str] = []
    for cover in covers:
        originals = cover.get("originals") or []
        original_uri = (((originals[0] if originals else {}).get("original") or {}).get("uri"))
        endpoint = endpoint_from_uri(original_uri)
        if endpoint:
            cover_original_uris.append(endpoint)

    cover_original_uris = list(dict.fromkeys(cover_original_uris))
    selected_cover_original_uris = cover_original_uris[:MAX_ORIGINAL_REQUESTS]
    if len(cover_original_uris) > len(selected_cover_original_uris):
        partial_data = True
    trace("covers", f"artist={artist_id} cover_original_uris total={len(cover_original_uris)} selected={len(selected_cover_original_uris)}")

    originals_raw, failed_original_requests, original_errors = fetch_many(
        ctx,
        selected_cover_original_uris,
        deadline=deadline,
    )
    if failed_original_requests:
        partial_data = True
    trace("covers", f"artist={artist_id} originals_raw ok={len(originals_raw)} failed={failed_original_requests}")
    originals = [
        o
        for o in originals_raw
        if o
        and o.get("performer")
        and (o.get("performer") or {}).get("uri")
        and o.get("uri")
        and o.get("title")
        and isinstance(o.get("covers"), list)
    ]

    originals = sorted_cover_list(originals)
    trace("covers", f"artist={artist_id} originals_valid={len(originals)}")
    cover_counts = [len(o.get("covers") or []) for o in originals] or [1]
    dmin, dmax = min(cover_counts), max(cover_counts)

    performer_image_cache: dict[str, str | None] = {}
    performer_image_lookups = 0

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    for original in originals:
        covers_len = len(original.get("covers") or [])
        performer = original.get("performer") or {}
        performer_uri = performer.get("uri")
        performer_name = performer.get("name")

        if performer_uri and performer_uri not in performer_image_cache:
            if performer_image_lookups >= MAX_COVER_ARTIST_IMAGE_LOOKUPS:
                performer_image_cache[performer_uri] = None
            else:
                performer_picture_resolved, _ = select_best_artist_picture(
                    None,
                    performer_name or "Unknown artist",
                    include_musicbrainz=False,
                    include_deezer=True,
                    probe_candidates=False,
                )
                performer_image_cache[performer_uri] = performer_picture_resolved
                performer_image_lookups += 1

        nodes.append(
            {
                "data": {
                    "id": original.get("uri"),
                    "label": original.get("title"),
                    "nodeType": "song",
                    "size": linear_scale(covers_len, dmin, dmax, 40, 70),
                    "color": "#FFF",
                    "bgColor": "#C00",
                    "opacity": 1,
                    "bgOpacity": 1,
                    "fontSize": linear_scale(covers_len, dmin, dmax, 10, 24),
                    "fontFamily": "Kreon",
                }
            }
        )
        edges.append(
            {
                "data": {
                    "source": original.get("uri"),
                    "target": performer_uri,
                    "weight": 1,
                    "color": "#666",
                    "opacity": 0.25,
                }
            }
        )
        nodes.append(
            {
                "data": {
                    "id": performer_uri,
                    "label": performer_name,
                    "nodeType": "artist",
                    "imageUrl": performer_image_cache.get(performer_uri),
                    "size": 1,
                    "color": "#333",
                    "bgColor": "#333",
                    "bgOpacity": 0,
                    "opacity": 1,
                    "fontSize": 12,
                    "fontFamily": "Big Shoulders Display",
                }
            }
        )

    network_data = dedupe_network_data(nodes + edges)
    trace("covers", f"artist={artist_id} network_items={len(network_data)}")

    diagnostics = {
        "performanceUrisTotal": len(performance_uris),
        "performanceUrisSelected": len(selected_performance_uris),
        "performanceResultsOk": len(performance_results),
        "performanceResultsFailed": failed_performance_requests,
        "coverOriginalUrisTotal": len(cover_original_uris),
        "coverOriginalUrisSelected": len(selected_cover_original_uris),
        "originalResultsOk": len(originals_raw),
        "originalResultsFailed": failed_original_requests,
        "originalsValid": len(originals),
        "networkItems": len(network_data),
        "artistImageResolvedCount": len([v for v in performer_image_cache.values() if v]),
        "artistImageLookupCount": performer_image_lookups,
        "sampleErrors": (performance_errors + original_errors)[:20],
        "imageCandidates": picture_probes,
    }

    return {
        "artist": {
            "id": artist_id,
            "uri": artist.get("uri"),
            "commonName": artist.get("commonName") or artist.get("name"),
            "picture": artist.get("picture"),
        },
        "artistPicture": artist.get("picture"),
        "artistPictureResolved": artist_picture,
        "coversCount": len(originals),
        "partialData": partial_data,
        "networkData": network_data,
        "diagnostics": diagnostics,
    }


def generate_originals_data(ctx: Context, artist_id: int, deadline: float | None = None) -> dict[str, Any]:
    artist = fetch_json(ctx, f"/artist/{artist_id}", deadline=deadline)
    artist_picture, picture_probes = select_best_artist_picture(
        artist.get("picture"),
        artist.get("commonName") or artist.get("name") or f"Artist {artist_id}",
    )
    trace("originals", f"artist={artist_id} selected_picture={artist_picture}")
    performances = fetch_json(ctx, f"/artist/{artist_id}/performances", deadline=deadline)

    performance_uris = []
    for item in performances:
        endpoint = endpoint_from_uri(item.get("uri"))
        if endpoint:
            performance_uris.append(endpoint)
    performance_uris = list(dict.fromkeys(performance_uris))

    selected_performance_uris = performance_uris[:MAX_PERFORMANCE_REQUESTS]
    partial_data = len(performance_uris) > len(selected_performance_uris)
    trace("originals", f"artist={artist_id} performance_uris total={len(performance_uris)} selected={len(selected_performance_uris)}")

    performance_results, failed_performance_requests, performance_errors = fetch_many(
        ctx,
        selected_performance_uris,
        deadline=deadline,
    )
    if failed_performance_requests:
        partial_data = True
    trace("originals", f"artist={artist_id} performance_results ok={len(performance_results)} failed={failed_performance_requests}")

    originals = [
        p
        for p in performance_results
        if p.get("isOriginal")
        and isinstance(p.get("originals"), list)
        and len(p.get("originals") or []) == 0
        and isinstance(p.get("covers"), list)
    ]

    if not originals:
        trace("originals", f"artist={artist_id} originals_valid=0")
        return {
            "artist": {
                "id": artist_id,
                "uri": artist.get("uri"),
                "commonName": artist.get("commonName") or artist.get("name"),
                "picture": artist.get("picture"),
            },
            "artistPicture": artist.get("picture"),
            "artistPictureResolved": artist_picture,
            "originalsCount": 0,
            "artistsCoveringCount": 0,
            "coversTotal": 0,
            "partialData": partial_data,
            "networkData": [],
            "diagnostics": {
                "performanceUrisTotal": len(performance_uris),
                "performanceUrisSelected": len(selected_performance_uris),
                "performanceResultsOk": len(performance_results),
                "performanceResultsFailed": failed_performance_requests,
                "originalsValid": 0,
                "networkItems": 0,
                "sampleErrors": performance_errors[:20],
                "imageCandidates": picture_probes,
            },
        }

    for original in originals:
        original["title"] = deburr(original.get("title") or "")
        original["covers"] = sorted(
            original.get("covers") or [],
            key=lambda c: ((c.get("performer") or {}).get("name") or "").lower(),
        )

    originals = sorted(
        originals,
        key=lambda o: (-len(o.get("covers") or []), (o.get("title") or "").lower()),
    )

    original_cover_counts = [len(o.get("covers") or []) for o in originals] or [1]
    dmin, dmax = min(original_cover_counts), max(original_cover_counts)

    artists_covering_map: dict[str, str] = {}
    for original in originals:
        for cover in original.get("covers") or []:
            performer = cover.get("performer") or {}
            uri = performer.get("uri")
            name = performer.get("name")
            if uri and name and uri not in artists_covering_map:
                artists_covering_map[uri] = name

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []

    for original in originals:
        covers_len = len(original.get("covers") or [])
        nodes.append(
            {
                "data": {
                    "id": original.get("uri"),
                    "label": original.get("title"),
                    "size": linear_scale(covers_len * 4, dmin, dmax, 40, 70),
                    "color": "#FFF",
                    "bgColor": "#C00",
                    "opacity": 1,
                    "bgOpacity": 1,
                    "fontSize": linear_scale(covers_len, dmin, dmax, 10, 24),
                    "fontFamily": "Kreon",
                    "nodeType": "song",
                }
            }
        )

        for cover in original.get("covers") or []:
            performer_uri = ((cover.get("performer") or {}).get("uri"))
            if performer_uri:
                edges.append(
                    {
                        "data": {
                            "source": original.get("uri"),
                            "target": performer_uri,
                            "weight": 1,
                            "color": "#666",
                            "opacity": 0.25,
                        }
                    }
                )

    for performer_uri, performer_name in artists_covering_map.items():
        current_covers_count = 0
        for original in originals:
            if any(((c.get("performer") or {}).get("uri") == performer_uri) for c in (original.get("covers") or [])):
                current_covers_count += 1

        nodes.append(
            {
                "data": {
                    "id": performer_uri,
                    "label": performer_name,
                    "size": linear_scale(max(current_covers_count, 1) * 4, dmin, dmax, 40, 70),
                    "color": "#333",
                    "bgColor": "#333",
                    "bgOpacity": 0,
                    "opacity": 1,
                    "fontSize": log_scale(max(current_covers_count, 1), 1, 25, 8, 20),
                    "fontFamily": "Big Shoulders Display",
                    "nodeType": "artist",
                }
            }
        )

    network_data = dedupe_network_data(nodes + edges)
    trace("originals", f"artist={artist_id} originals_valid={len(originals)} artists_covering={len(artists_covering_map)} network_items={len(network_data)}")

    diagnostics = {
        "performanceUrisTotal": len(performance_uris),
        "performanceUrisSelected": len(selected_performance_uris),
        "performanceResultsOk": len(performance_results),
        "performanceResultsFailed": failed_performance_requests,
        "originalsValid": len(originals),
        "artistsCoveringCount": len(artists_covering_map),
        "networkItems": len(network_data),
        "sampleErrors": performance_errors[:20],
        "imageCandidates": picture_probes,
    }

    return {
        "artist": {
            "id": artist_id,
            "uri": artist.get("uri"),
            "commonName": artist.get("commonName") or artist.get("name"),
            "picture": artist.get("picture"),
        },
        "artistPicture": artist.get("picture"),
        "artistPictureResolved": artist_picture,
        "originalsCount": len(originals),
        "artistsCoveringCount": len(artists_covering_map),
        "coversTotal": sum(original_cover_counts),
        "partialData": partial_data,
        "networkData": network_data,
        "diagnostics": diagnostics,
    }


def write_json(file_path: Path, payload: dict[str, Any]) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    payload_with_meta = {
        **payload,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }
    file_path.write_text(json.dumps(payload_with_meta, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate cached graph JSON for Covers and Originals pages")
    parser.add_argument(
        "--artist",
        type=int,
        default=None,
        help="Generate data for one specific artist ID.",
    )
    parser.add_argument(
        "--artists",
        nargs="*",
        type=int,
        default=None,
        help="Optional list of artist IDs to generate. Default: first 3 artists in ARTIST_OPTIONS.",
    )
    parser.add_argument(
        "--no-cache",
        action="store_true",
        help="Disable endpoint cache reads and force fresh network fetch.",
    )
    parser.add_argument(
        "--output",
        default="frontend/data/graphs",
        help="Output directory for generated files.",
    )
    parser.add_argument(
        "--base-url",
        default=os.environ.get("SHS_BASE_URL", SHS_API),
        help="API base URL. Use local proxy for client-equivalent behavior, e.g. http://localhost:5173/api/secondhandsongs",
    )
    parser.add_argument(
        "--artist-timeout-seconds",
        type=int,
        default=int(os.environ.get("ARTIST_TIMEOUT_SECONDS", str(DEFAULT_ARTIST_TIMEOUT_SECONDS))),
        help="Hard timeout in seconds per artist. Set 0 to disable.",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    root_dir = Path(__file__).resolve().parent.parent
    output_dir = (root_dir / args.output).resolve()
    cache_dir = (root_dir / "data/.cache").resolve()
    shs_cache_dir = (root_dir / "frontend/.shs-cache").resolve()

    artists: list[dict[str, Any]]
    if args.artist is not None:
        match = next((item for item in ARTIST_OPTIONS if item["id"] == args.artist), None)
        artists = [match] if match else [{"id": args.artist, "name": f"Artist {args.artist}"}]
    elif args.artists:
        target_artist_ids = set(args.artists)
        known_by_id = {item["id"]: item for item in ARTIST_OPTIONS}
        artists = []
        for artist_id in args.artists:
            if artist_id in known_by_id:
                artists.append(known_by_id[artist_id])
            else:
                artists.append({"id": artist_id, "name": f"Artist {artist_id}"})
    else:
        artists = ARTIST_OPTIONS.copy()

    if not artists:
        print("No artists selected. Use --artist <id> or --artists <id...>.")
        return 1

    ctx = Context(
        root_dir=root_dir,
        output_dir=output_dir,
        cache_dir=cache_dir,
        shs_cache_dir=shs_cache_dir,
        base_url=args.base_url,
        api_key=os.environ.get("SHS_API_KEY"),
        use_cache=not args.no_cache,
    )

    print(f"Generating graph data for {len(artists)} artist(s)")
    print(f"Output: {ctx.output_dir}")
    print(f"Base URL: {ctx.base_url}")
    print(f"Cache: {ctx.cache_dir} (use_cache={ctx.use_cache})")
    print(f"SHS cache fallback: {ctx.shs_cache_dir}")
    print(f"Artist timeout: {args.artist_timeout_seconds}s")

    failures: list[str] = []

    for artist in artists:
        artist_id = artist["id"]
        artist_name = artist["name"]
        print(f"\n[{artist_id}] {artist_name}")
        deadline = None
        if args.artist_timeout_seconds > 0:
            deadline = time.monotonic() + args.artist_timeout_seconds
            trace("artist", f"artist={artist_id} deadline_in={args.artist_timeout_seconds}s")
        try:
            covers_data = generate_covers_data(ctx, artist_id, deadline=deadline)
            originals_data = generate_originals_data(ctx, artist_id, deadline=deadline)

            covers_path = ctx.output_dir / "covers" / f"{artist_id}.json"
            originals_path = ctx.output_dir / "originals" / f"{artist_id}.json"
            write_json(covers_path, covers_data)
            write_json(originals_path, originals_data)
            print(f"  covers -> {covers_path.relative_to(ctx.root_dir)}")
            print(f"  originals -> {originals_path.relative_to(ctx.root_dir)}")
        except Exception as exc:  # noqa: BLE001
            message = f"[{artist_id}] {artist_name}: {exc}"
            failures.append(message)
            print(f"  ERROR: {message}")

    manifest = {
        "artists": artists,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "coversPath": "graphs/covers/<artist_id>.json",
        "originalsPath": "graphs/originals/<artist_id>.json",
        "failures": failures,
    }
    write_json(ctx.output_dir / "manifest.json", manifest)

    if failures:
        print("\nCompleted with failures:")
        for item in failures:
            print(f"  - {item}")
        return 1

    print("\nGeneration complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
