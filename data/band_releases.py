"""Fetch first-release dates for artist timeline annotations."""

from __future__ import annotations

import re
from typing import Callable
from urllib.error import URLError
from urllib.parse import urlencode


def discogs_release_annotation(entry: dict, release: dict, master: dict | None = None) -> dict | None:
    descriptions = {description.casefold() for format_item in release.get("formats", []) for description in format_item.get("descriptions", [])}
    if release.get("status") != "Accepted" or "unofficial release" in descriptions:
        return None
    release_type = "EP" if "ep" in descriptions else "Single" if "single" in descriptions else "Album" if descriptions.intersection({"album", "mini-album", "compilation", "comp"}) else None
    if release_type is None:
        return None
    secondary = []
    notes = f"{(master or {}).get('notes', '')}\n{release.get('notes', '')}"
    if descriptions.intersection({"compilation", "comp"}) or re.search(r"\bcompilation (?:album|of)\b", notes, re.I):
        secondary.append("Compilation")
    if "live" in descriptions or re.search(r"\b(?:recorded|recording)\s+live\b|\blive\s+(?:album|recordings?|at|in)\b", notes, re.I):
        secondary.append("Live")
    year = (master or {}).get("year") or entry.get("year") or release.get("year")
    if not isinstance(year, int) or year <= 0:
        return None
    date = release.get("released") or str(year)
    if not re.fullmatch(r"\d{4}(?:-\d{2})?(?:-\d{2})?", date) or date[:4] != str(year):
        date = str(year)
    date = re.sub(r"(?:-00)+$", "", date)
    entity = "master" if master else "release"
    entity_id = master["id"] if master else release["id"]
    return {
        "id": f"discogs-{entity}:{entity_id}", "title": (master or {}).get("title") or entry.get("title") or release["title"],
        "type": release_type, "date": date, "year": year,
        "url": f"https://www.discogs.com/{entity}/{entity_id}",
        "secondaryTypes": secondary, "disambiguation": "", "source": "Discogs",
        "official": True, "editionUrl": f"https://www.discogs.com/release/{release['id']}",
    }


def discogs_release_annotations(artist_id: int, fetch: Callable[[str, str], dict]) -> dict:
    entries = {}
    page = 1
    pages = 1
    while page <= pages:
        query = urlencode({"sort": "year", "sort_order": "asc", "per_page": 100, "page": page})
        payload = fetch(f"https://api.discogs.com/artists/{artist_id}/releases?{query}", f"discography-{artist_id}-{page}")
        if "releases" not in payload or "pagination" not in payload:
            raise ValueError("Unexpected Discogs discography response")
        pages = payload["pagination"]["pages"]
        if not payload["releases"] and page < pages:
            raise ValueError("Incomplete Discogs discography pagination")
        for entry in payload["releases"]:
            if entry.get("role") == "Main" and entry.get("type") in ("master", "release"):
                entries[(entry["type"], entry["id"])] = entry
        page += 1
    master_ids = {entry_id for entity, entry_id in entries if entity == "master"}
    selected = {}
    excluded = 0
    errors = []
    for index, entry in enumerate(entries.values(), 1):
        try:
            if entry["type"] == "release" and "unofficial release" in entry.get("format", "").casefold():
                excluded += 1
                continue
            master = None
            if entry["type"] == "master":
                master = fetch(f"https://api.discogs.com/masters/{entry['id']}", f"discography-master-{entry['id']}")
                release_id = master["main_release"]
            else:
                release_id = entry["id"]
            release = fetch(f"https://api.discogs.com/releases/{release_id}", f"discography-release-{release_id}")
            if release.get("id") != release_id:
                raise ValueError("Unexpected Discogs release identity")
            if not any(artist.get("id") == artist_id for artist in release.get("artists", [])):
                excluded += 1
                continue
            if master is None and release.get("master_id"):
                if release["master_id"] in master_ids:
                    continue
                master = fetch(f"https://api.discogs.com/masters/{release['master_id']}", f"discography-master-{release['master_id']}")
            annotation = discogs_release_annotation(entry, release, master)
            if annotation:
                selected[annotation["id"]] = annotation
            else:
                excluded += 1
        except (URLError, TimeoutError, OSError, ValueError, KeyError) as exc:
            errors.append(f"{entry.get('title', entry['id'])}: {exc}")
        if index % 20 == 0:
            print(f"Discogs discography: verified {index}/{len(entries)} main-artist entries.", flush=True)
    return {
        "status": "partial" if errors else "complete", "source": "Discogs", "officialOnly": True,
        "sourceUrl": f"https://www.discogs.com/artist/{artist_id}",
        "mainArtistEntryCount": len(entries), "excludedCount": excluded, "errors": errors,
        "items": sorted(selected.values(), key=lambda item: (item["date"], item["type"], item["title"].casefold())),
    }


def release_annotations(artist_id: str, fetch: Callable[[str, str], dict]) -> dict:
    annotations = {}
    undated = 0
    counts = {}
    for entity, plural in (("release-group", "release-groups"), ("recording", "recordings")):
        offset = 0
        total = None
        while total is None or offset < total:
            query = urlencode({"artist": artist_id, "limit": 100, "offset": offset, "fmt": "json"})
            payload = fetch(f"https://musicbrainz.org/ws/2/{entity}?{query}", f"releases-{artist_id}-{entity}-{offset}")
            if plural not in payload or f"{entity}-count" not in payload:
                raise ValueError(f"Unexpected MusicBrainz {entity} browse response")
            items = payload[plural]
            total = payload[f"{entity}-count"]
            if not items and offset < total:
                raise ValueError(f"Incomplete MusicBrainz {entity} pagination at offset {offset}")
            for item in items:
                release_type = "Recording" if entity == "recording" else item.get("primary-type")
                if release_type not in ("Album", "EP", "Single", "Recording"):
                    continue
                date = item.get("first-release-date") or ""
                if not re.fullmatch(r"\d{4}(?:-\d{2})?(?:-\d{2})?", date):
                    undated += 1
                    continue
                annotation_id = f"{entity}:{item['id']}"
                annotations[annotation_id] = {
                    "id": annotation_id, "title": item["title"], "type": release_type,
                    "date": date, "year": int(date[:4]),
                    "url": f"https://musicbrainz.org/{entity}/{item['id']}",
                    "secondaryTypes": item.get("secondary-types", []),
                    "disambiguation": item.get("disambiguation", ""),
                }
            offset += len(items)
            if not items:
                break
        counts[entity] = total
    return {
        "status": "complete", "source": "MusicBrainz", "sourceCounts": counts,
        "undatedCount": undated,
        "items": sorted(annotations.values(), key=lambda item: (item["date"], item["type"], item["title"].casefold(), item["id"])),
    }