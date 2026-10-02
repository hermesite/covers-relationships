#!/usr/bin/env python3
"""Generate precomputed graph datasets for Covers and Originals pages.

Outputs JSON files to:
    frontend/data/graphs/covers/<artist_id>.json
    frontend/data/graphs/originals/<artist_id>.json
"""

from __future__ import annotations

import argparse
import fcntl
import json
import math
import os
import re
import sys
import time
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

SHS_API = "https://api.secondhandsongs.com"
MB_API = "https://musicbrainz.org/ws/2"
WIKIDATA_ENTITY = "https://www.wikidata.org/wiki/Special:EntityData"
DEEZER_SEARCH = "https://api.deezer.com/search/artist"
DEEZER_ALBUM_SEARCH = "https://api.deezer.com/search/album"
ARTIST_OPTIONS = [
    {"id": 14076, "name": "The Cramps"}
]

MAX_PERFORMANCE_REQUESTS = int(os.environ.get("MAX_PERFORMANCE_REQUESTS", "0"))
MAX_ORIGINAL_REQUESTS = int(os.environ.get("MAX_ORIGINAL_REQUESTS", "0"))
RETRY_BACKOFF_SECONDS = 2.0
RATE_LIMIT_BACKOFF_SECONDS = 60.0
MAX_RETRIES = 5
DEFAULT_ARTIST_TIMEOUT_SECONDS = 900
ANONYMOUS_RATE_LIMITS = (
    (60_000, 20),
    (3_600_000, 200),
    (86_400_000, 1000),
)


@dataclass
class Context:
    root_dir: Path
    output_dir: Path
    cache_dir: Path
    shs_cache_dir: Path
    base_url: str
    api_key: str | None
    use_cache: bool
    rate_limit_file: Path
    rate_limits: tuple[tuple[int, int], ...]
    blocked_until_ms: int = 0
    session_cache: dict[str, Any] = field(default_factory=dict)


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


def _request_json(url: str, api_key: str | None, timeout_seconds: float = 30.0) -> tuple[Any, dict[str, str]]:
    headers = {
        "Accept": "application/json",
        "User-Agent": "secondhand-covers-data-generator/1.0",
    }
    if api_key:
        headers["X-API-Key"] = api_key
    request = Request(url, headers=headers)
    with urlopen(request, timeout=timeout_seconds) as response:
        payload = response.read().decode("utf-8")
        return json.loads(payload), dict(response.headers.items())


def _http_error_message(exc: HTTPError) -> str:
    try:
        payload = json.loads(exc.read().decode("utf-8"))
        error = payload.get("error") or {}
        message = error.get("message")
        code = error.get("code")
        if message:
            return f"API {code}: {message}" if code is not None else str(message)
    except (AttributeError, json.JSONDecodeError, UnicodeDecodeError):
        pass
    return str(exc.reason)


def _remaining_seconds(deadline: float | None) -> float | None:
    if deadline is None:
        return None
    return deadline - time.monotonic()


def _rate_limit_wait_ms(
    timestamps: list[int],
    now_ms: int,
    limits: tuple[tuple[int, int], ...],
) -> int:
    wait_ms = 0
    for window_ms, request_limit in limits:
        in_window = [stamp for stamp in timestamps if now_ms - stamp < window_ms]
        if len(in_window) >= request_limit:
            wait_ms = max(wait_ms, in_window[-request_limit] + window_ms - now_ms)
    return wait_ms


def _sleep_with_deadline(seconds: float, deadline: float | None, reason: str) -> None:
    remaining = _remaining_seconds(deadline)
    if remaining is not None and remaining <= seconds:
        raise ArtistTimeoutError(f"artist timeout reached while waiting for {reason}")
    time.sleep(seconds)


def _reserve_request_slot(ctx: Context, deadline: float | None) -> None:
    if ctx.base_url.rstrip("/") != SHS_API:
        return

    ctx.rate_limit_file.parent.mkdir(parents=True, exist_ok=True)
    with ctx.rate_limit_file.open("a+", encoding="utf-8") as rate_file:
        fcntl.flock(rate_file.fileno(), fcntl.LOCK_EX)
        while True:
            rate_file.seek(0)
            try:
                timestamps = [int(stamp) for stamp in json.load(rate_file)]
            except (json.JSONDecodeError, ValueError):
                timestamps = []

            now_ms = int(time.time() * 1000)
            longest_window_ms = max(window_ms for window_ms, _ in ctx.rate_limits)
            timestamps = [stamp for stamp in timestamps if now_ms - stamp < longest_window_ms]
            wait_ms = max(
                _rate_limit_wait_ms(timestamps, now_ms, ctx.rate_limits),
                ctx.blocked_until_ms - now_ms,
            )
            if wait_ms <= 0:
                timestamps.append(now_ms)
                rate_file.seek(0)
                rate_file.truncate()
                json.dump(timestamps, rate_file)
                rate_file.flush()
                os.fsync(rate_file.fileno())
                return

            wait_seconds = wait_ms / 1000.0 + 0.1
            trace("rate-limit", f"waiting {math.ceil(wait_seconds)}s for an API request slot")
            _sleep_with_deadline(wait_seconds, deadline, "SecondHandSongs quota")


def _apply_rate_limit_headers(ctx: Context, headers: dict[str, str]) -> None:
    normalized = {key.lower(): value for key, value in headers.items()}
    if ctx.api_key:
        try:
            minute_limit = int(normalized["x-ratelimit-minute-limit"])
            hour_limit = int(normalized["x-ratelimit-hour-limit"])
            ctx.rate_limits = ((60_000, minute_limit), (3_600_000, hour_limit))
        except (KeyError, ValueError):
            pass

    reset_timestamps = []
    for scope in ("minute", "hour"):
        try:
            if int(normalized[f"x-ratelimit-{scope}-remaining"]) == 0:
                reset_timestamps.append(int(normalized[f"x-ratelimit-{scope}-reset"]) * 1000)
        except (KeyError, ValueError):
            continue
    if reset_timestamps:
        ctx.blocked_until_ms = max(ctx.blocked_until_ms, max(reset_timestamps))

    try:
        if int(normalized["x-ratelimit-absolute-remaining"]) == 0:
            raise FetchError("SecondHandSongs API key request budget is exhausted")
    except (KeyError, ValueError):
        pass


def fetch_json(ctx: Context, endpoint: str, deadline: float | None = None) -> Any:
    if not endpoint.startswith("/"):
        raise ValueError(f"endpoint must start with '/': {endpoint}")

    cache_file = _cache_file(ctx, endpoint)
    shs_cache_file = _shs_cache_file(ctx, endpoint)
    if endpoint in ctx.session_cache:
        return ctx.session_cache[endpoint]
    if ctx.use_cache:
        if cache_file.exists():
            data = json.loads(cache_file.read_text(encoding="utf-8"))
            ctx.session_cache[endpoint] = data
            return data
        if shs_cache_file.exists():
            data = json.loads(shs_cache_file.read_text(encoding="utf-8"))
            ctx.session_cache[endpoint] = data
            return data

    url = ctx.base_url.rstrip("/") + endpoint
    for attempt in range(1, MAX_RETRIES + 1):
        remaining = _remaining_seconds(deadline)
        if remaining is not None and remaining <= 0:
            raise ArtistTimeoutError(f"artist timeout reached before fetching {endpoint}")
        try:
            _reserve_request_slot(ctx, deadline)
            request_timeout = 30.0
            if remaining is not None:
                request_timeout = max(1.0, min(30.0, remaining))
            data, response_headers = _request_json(url, ctx.api_key, timeout_seconds=request_timeout)
            _apply_rate_limit_headers(ctx, response_headers)
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            cache_file.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            ctx.session_cache[endpoint] = data
            return data
        except HTTPError as exc:
            error_message = _http_error_message(exc)
            is_rate_limit = exc.code == 429 or (exc.code == 403 and "too many requests" in error_message.lower())
            if is_rate_limit and attempt < MAX_RETRIES:
                retry_after = exc.headers.get("Retry-After") if exc.headers else None
                try:
                    wait_seconds = max(float(retry_after), RATE_LIMIT_BACKOFF_SECONDS)
                except (TypeError, ValueError):
                    wait_seconds = RATE_LIMIT_BACKOFF_SECONDS
                ctx.blocked_until_ms = max(ctx.blocked_until_ms, int((time.time() + wait_seconds) * 1000))
                trace("rate-limit", f"HTTP {exc.code} for {endpoint}; retrying after {math.ceil(wait_seconds)}s")
                _sleep_with_deadline(wait_seconds, deadline, "SecondHandSongs retry")
                continue
            if exc.code in (500, 502, 503, 504) and attempt < MAX_RETRIES:
                _sleep_with_deadline(RETRY_BACKOFF_SECONDS * attempt, deadline, "upstream retry")
                continue
            raise FetchError(f"HTTP {exc.code} for {endpoint}: {error_message}") from exc
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


def normalize_artist_search_name(artist_name: str) -> str:
    normalized = re.sub(r"(?:\s+\[[^\[\]]+\])+\s*$", "", artist_name).strip()
    return normalized or artist_name.strip()


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
        search_name = normalize_artist_search_name(artist_name)
        search = _http_json_public(f"{MB_API}/artist/?query=artist:{quote(search_name)}&fmt=json")
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


def _deezer_images(artist_name: str, timeout_seconds: float = 8.0) -> list[str]:
    try:
        search_name = normalize_artist_search_name(artist_name)
        data = _http_json_public(f"{DEEZER_SEARCH}?q={quote(search_name)}", timeout_seconds=timeout_seconds)
        items = data.get("data", [])
        if not items:
            return []
        exact_matches = [
            item for item in items if (item.get("name") or "").casefold() == search_name.casefold()
        ]
        matches = exact_matches
        urls = [
            item.get("picture_xl") or item.get("picture_medium") or item.get("picture")
            for item in matches
        ]
        return list(dict.fromkeys(url for url in urls if url and "/artist//" not in url))
    except Exception:
        return []


@lru_cache(maxsize=16)
def _deezer_album_catalog(artist_name: str) -> list[dict[str, Any]]:
    try:
        data = _http_json_public(f"{DEEZER_ALBUM_SEARCH}?q={quote(artist_name, safe='')}", timeout_seconds=5.0)
        return data.get("data", [])
    except Exception:
        return []


def _album_match_key(title: str) -> str:
    return "".join(char for char in deburr(title).casefold() if char.isalnum())


def _deezer_album_image(artist_name: str, album_title: str) -> str | None:
    try:
        search_name = normalize_artist_search_name(artist_name)
        title_key = _album_match_key(album_title)
        for item in _deezer_album_catalog(search_name):
            item_artist = (item.get("artist") or {}).get("name") or ""
            if _album_match_key(item.get("title") or "") == title_key and item_artist.casefold() == search_name.casefold():
                return item.get("cover_xl") or item.get("cover_big") or item.get("cover_medium")

        query = quote(f"{album_title} {search_name}", safe="")
        results = _http_json_public(f"{DEEZER_ALBUM_SEARCH}?q={query}", timeout_seconds=5.0)
        for item in results.get("data", []):
            item_artist = (item.get("artist") or {}).get("name") or ""
            if _album_match_key(item.get("title") or "") == title_key and item_artist.casefold() == search_name.casefold():
                return item.get("cover_xl") or item.get("cover_big") or item.get("cover_medium")
    except Exception:
        pass
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
        for index, deezer_url in enumerate(_deezer_images(artist_name, timeout_seconds=5.0), start=1):
            candidates.append({"source": f"deezer.{index}", "url": deezer_url})

    probes: list[dict[str, str]] = []
    selected_url: str | None = None
    for candidate in candidates:
        if not probe_candidates:
            probes.append({"source": candidate["source"], "url": candidate["url"], "status": "not-probed", "ok": "unknown"})
            if selected_url is None:
                selected_url = candidate["url"]
            continue
        ok, status = _probe_image_url(candidate["url"])
        probes.append({"source": candidate["source"], "url": candidate["url"], "status": status, "ok": str(ok)})
        if ok and selected_url is None:
            selected_url = candidate["url"]

    return selected_url or resolved_raw or raw_picture, probes


def cover_artist_count(performance: dict[str, Any]) -> int:
    return len({
        performer_uri
        for cover in performance.get("covers") or []
        if (performer_uri := (cover.get("performer") or {}).get("uri"))
    })


def performance_release_data(performance: dict[str, Any]) -> dict[str, Any]:
    releases = performance.get("releases") or []
    release_type = next(
        (subtype for subtype in ("album", "EP", "single") if any(release.get("entitySubType") == subtype for release in releases)),
        None,
    )
    albums = [
        {
            "entitySubType": release.get("entitySubType"),
            "uri": release.get("uri"),
            "title": release.get("title"),
        }
        for release in releases
        if release_type is not None and release.get("entitySubType") == release_type
    ]
    return {"date": performance.get("firstReleaseDate"), "releases": albums}


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
    artist_picture = resolve_artist_picture_url(artist.get("picture"))
    trace("covers", f"artist={artist_id} selected_picture={artist_picture}")
    performances = fetch_json(ctx, f"/artist/{artist_id}/performances", deadline=deadline)

    performance_uris = []
    for item in performances:
        endpoint = endpoint_from_uri(item.get("uri"))
        if endpoint:
            performance_uris.append(endpoint)
    performance_uris = list(dict.fromkeys(performance_uris))

    selected_performance_uris = (
        performance_uris[:MAX_PERFORMANCE_REQUESTS]
        if MAX_PERFORMANCE_REQUESTS > 0
        else performance_uris
    )
    partial_data = len(performance_uris) > len(selected_performance_uris)
    trace("covers", f"artist={artist_id} performance_uris total={len(performance_uris)} selected={len(selected_performance_uris)}")

    performance_results, failed_performance_requests, performance_errors = fetch_many(
        ctx,
        selected_performance_uris,
        deadline=deadline,
    )
    if failed_performance_requests:
        first_error = performance_errors[0] if performance_errors else "unknown error"
        raise FetchError(f"{failed_performance_requests} selected performance requests failed; first: {first_error}")
    trace("covers", f"artist={artist_id} performance_results ok={len(performance_results)} failed={failed_performance_requests}")

    covers = [
        p
        for p in performance_results
        if not p.get("isOriginal") and isinstance(p.get("originals"), list) and p.get("originals")
    ]

    album_images: dict[str, str | None] = {}
    album_years: dict[str, int] = {}
    release_details: dict[str, dict[str, Any]] = {}
    for cover in covers:
        for album in performance_release_data(cover)["releases"]:
            uri, title = album.get("uri"), album.get("title")
            if uri and title and uri not in album_images:
                if album.get("entitySubType") in ("EP", "single"):
                    endpoint = endpoint_from_uri(uri)
                    if endpoint:
                        release_details[uri] = fetch_json(ctx, endpoint, deadline=deadline)
                search_title = re.sub(r"\s+EP$", "", title, flags=re.IGNORECASE)
                album_images[uri] = _deezer_album_image(artist.get("commonName") or artist.get("name") or "", search_title)
                if not album_images[uri]:
                    album_images[uri] = resolve_artist_picture_url((release_details.get(uri) or {}).get("picture"))
            date = (release_details.get(uri) or {}).get("date") or cover.get("firstReleaseDate") or ""
            if uri and date[:4].isdigit():
                year = int(date[:4])
                album_years[uri] = min(year, album_years.get(uri, year))

    cover_releases_by_original: dict[str, list[dict[str, Any]]] = {}
    for cover in covers:
        albums = [
            {
                **album,
                **({"releaseDetails": release_details[album["uri"]]} if album.get("uri") in release_details else {}),
                **({"date": release_details[album["uri"]].get("date")} if album.get("uri") in release_details else {}),
                "year": album_years.get(album.get("uri")),
                "imageUrl": album_images.get(album.get("uri")),
            }
            for album in performance_release_data(cover)["releases"]
        ]
        for reference in cover.get("originals") or []:
            original_uri = (reference.get("original") or {}).get("uri")
            if not original_uri:
                continue
            releases = cover_releases_by_original.setdefault(original_uri, [])
            for album in albums:
                if album.get("uri") and not any(release.get("uri") == album["uri"] for release in releases):
                    releases.append(album)

    for original_uri, releases in cover_releases_by_original.items():
        preferred_type = next(
            (subtype for subtype in ("album", "EP", "single") if any(release.get("entitySubType") == subtype for release in releases)),
            None,
        )
        cover_releases_by_original[original_uri] = [
            release for release in releases if release.get("entitySubType") == preferred_type
        ]

    cover_original_uris: list[str] = []
    for cover in covers:
        originals = cover.get("originals") or []
        original_uri = (((originals[0] if originals else {}).get("original") or {}).get("uri"))
        endpoint = endpoint_from_uri(original_uri)
        if endpoint:
            cover_original_uris.append(endpoint)

    cover_original_uris = list(dict.fromkeys(cover_original_uris))
    selected_cover_original_uris = (
        cover_original_uris[:MAX_ORIGINAL_REQUESTS]
        if MAX_ORIGINAL_REQUESTS > 0
        else cover_original_uris
    )
    if len(cover_original_uris) > len(selected_cover_original_uris):
        partial_data = True
    trace("covers", f"artist={artist_id} cover_original_uris total={len(cover_original_uris)} selected={len(selected_cover_original_uris)}")

    originals_raw, failed_original_requests, original_errors = fetch_many(
        ctx,
        selected_cover_original_uris,
        deadline=deadline,
    )
    if failed_original_requests:
        first_error = original_errors[0] if original_errors else "unknown error"
        raise FetchError(f"{failed_original_requests} cover-original requests failed; first: {first_error}")
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

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    for original in originals:
        covers_len = len(original.get("covers") or [])
        performer = original.get("performer") or {}
        performer_uri = performer.get("uri")
        performer_name = performer.get("name")

        nodes.append(
            {
                "data": {
                    "id": original.get("uri"),
                    "label": original.get("title"),
                    "nodeType": "song",
                    **performance_release_data(original),
                    "coverArtistCount": cover_artist_count(original),
                    "coverReleases": cover_releases_by_original.get(original.get("uri"), []),
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
                    "imageUrl": None,
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
        "artistImageResolvedCount": 0,
        "artistImageLookupCount": 0,
        "sampleErrors": (performance_errors + original_errors)[:20],
        "imageCandidates": [],
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
    artist_picture = resolve_artist_picture_url(artist.get("picture"))
    trace("originals", f"artist={artist_id} selected_picture={artist_picture}")
    performances = fetch_json(ctx, f"/artist/{artist_id}/performances", deadline=deadline)

    performance_uris = []
    for item in performances:
        endpoint = endpoint_from_uri(item.get("uri"))
        if endpoint:
            performance_uris.append(endpoint)
    performance_uris = list(dict.fromkeys(performance_uris))

    selected_performance_uris = (
        performance_uris[:MAX_PERFORMANCE_REQUESTS]
        if MAX_PERFORMANCE_REQUESTS > 0
        else performance_uris
    )
    partial_data = len(performance_uris) > len(selected_performance_uris)
    trace("originals", f"artist={artist_id} performance_uris total={len(performance_uris)} selected={len(selected_performance_uris)}")

    performance_results, failed_performance_requests, performance_errors = fetch_many(
        ctx,
        selected_performance_uris,
        deadline=deadline,
    )
    if failed_performance_requests:
        first_error = performance_errors[0] if performance_errors else "unknown error"
        raise FetchError(f"{failed_performance_requests} selected performance requests failed; first: {first_error}")
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
                "imageCandidates": [],
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
                    **performance_release_data(original),
                    "coverArtistCount": cover_artist_count(original),
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
        "imageCandidates": [],
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
        rate_limit_file=cache_dir / "_sent.json",
        rate_limits=ANONYMOUS_RATE_LIMITS,
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
