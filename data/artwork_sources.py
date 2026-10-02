"""Cached identity-matched artwork lookups for static graph enrichment."""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
from pathlib import Path
from urllib.parse import quote, urlencode, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data/.cache/artwork"
LAST_REQUEST: dict[str, float] = {}


def request_json(url: str) -> dict:
    host = urlparse(url).hostname or ""
    cache_file = CACHE / (hashlib.sha256(url.encode()).hexdigest() + ".json")
    if cache_file.exists():
        return json.loads(cache_file.read_text(encoding="utf-8"))
    interval = 1.1 if host in ("musicbrainz.org", "api.discogs.com") else 0.1
    wait = interval - (time.monotonic() - LAST_REQUEST.get(host, 0))
    if wait > 0:
        time.sleep(wait)
    headers = {"Accept": "application/json", "User-Agent": "SecondhandCovers/0.1 (artwork enrichment)"}
    if host == "api.discogs.com":
        token = os.environ.get("DISCOGS_TOKEN")
        if not token:
            return {}
        headers["Authorization"] = "Discogs token=" + token
    LAST_REQUEST[host] = time.monotonic()
    try:
        with urlopen(Request(url, headers=headers), timeout=20) as response:
            data = json.load(response)
        CACHE.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps(data), encoding="utf-8")
        return data
    except Exception:
        return {}


def match_key(value: str) -> str:
    return "".join(char for char in value.casefold() if char.isalnum())


def discogs_name(value: str) -> str:
    return re.sub(r"\s+\(\d+\)$", "", value).strip()


def discogs_image(artist_name: str, album_title: str | None = None) -> str | None:
    query = {"type": "release" if album_title else "artist", "per_page": 20}
    if album_title:
        query.update({"artist": artist_name, "release_title": album_title})
    else:
        query["q"] = artist_name
    results = request_json("https://api.discogs.com/database/search?" + urlencode(query))
    for item in results.get("results", []):
        title = item.get("title") or ""
        if album_title:
            credit, separator, release_title = title.partition(" - ")
            if not separator or match_key(discogs_name(credit)) != match_key(artist_name):
                continue
            if match_key(release_title) != match_key(album_title):
                continue
        elif match_key(discogs_name(title)) != match_key(artist_name):
            continue
        details = request_json(item.get("resource_url") or "") if item.get("resource_url") else {}
        images = details.get("images") or []
        primary = next((image for image in images if image.get("type") == "primary"), None)
        if primary and primary.get("uri"):
            return primary["uri"]
        if images and images[0].get("uri"):
            return images[0]["uri"]
        if item.get("cover_image") and "spacer.gif" not in item["cover_image"]:
            return item["cover_image"]
    return None


def relation_image(relations: list[dict]) -> str | None:
    for relation in relations:
        resource = (relation.get("url") or {}).get("resource") or ""
        if relation.get("type") == "wikidata" and resource.startswith("https://www.wikidata.org/wiki/"):
            qid = resource.rsplit("/", 1)[-1]
            entity = request_json(f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json")
            claims = ((entity.get("entities") or {}).get(qid) or {}).get("claims") or {}
            for claim in claims.get("P18", []):
                filename = ((claim.get("mainsnak") or {}).get("datavalue") or {}).get("value")
                if isinstance(filename, str):
                    filename = filename.replace(" ", "_")
                    digest = hashlib.md5(filename.encode()).hexdigest()
                    return f"https://upload.wikimedia.org/wikipedia/commons/{digest[0]}/{digest[:2]}/{quote(filename)}"
        if relation.get("type") == "wikipedia" and resource.startswith("https://en.wikipedia.org/wiki/"):
            title = resource.split("/wiki/", 1)[-1]
            summary = request_json("https://en.wikipedia.org/api/rest_v1/page/summary/" + title)
            image = (summary.get("originalimage") or summary.get("thumbnail") or {}).get("source")
            if image:
                return image
    return None


def musicbrainz_artist_image(artist_name: str) -> str | None:
    query = urlencode({"query": 'artist:"' + artist_name.replace('"', '') + '"', "fmt": "json"})
    data = request_json("https://musicbrainz.org/ws/2/artist/?" + query)
    matches = [item for item in data.get("artists", []) if match_key(item.get("name") or "") == match_key(artist_name)]
    if len(matches) != 1:
        return None
    details = request_json(f"https://musicbrainz.org/ws/2/artist/{matches[0]['id']}?inc=url-rels&fmt=json")
    return relation_image(details.get("relations") or [])


def musicbrainz_album_image(artist_name: str, album_title: str) -> str | None:
    query = urlencode({"query": 'releasegroup:"' + album_title.replace('"', '') + '"', "fmt": "json", "limit": 50})
    data = request_json("https://musicbrainz.org/ws/2/release-group/?" + query)
    for group in data.get("release-groups", []):
        if match_key(group.get("title") or "") != match_key(album_title):
            continue
        credits = [credit.get("name") or (credit.get("artist") or {}).get("name") or "" for credit in group.get("artist-credit", []) if isinstance(credit, dict)]
        if not any(match_key(credit) == match_key(artist_name) for credit in credits):
            continue
        art = request_json(f"https://coverartarchive.org/release-group/{group['id']}")
        for image in art.get("images", []):
            if image.get("front"):
                return (image.get("thumbnails") or {}).get("500") or image.get("image")
        details = request_json(f"https://musicbrainz.org/ws/2/release-group/{group['id']}?inc=url-rels&fmt=json")
        image = relation_image(details.get("relations") or [])
        if image:
            return image
    return None