#!/usr/bin/env python3
"""Probe multiple public data sources for artist image candidates.

Sources:
- SecondHandSongs API (artist picture field)
- MusicBrainz (artist lookup + wikipedia/wikidata relations)
- Wikipedia REST summary (thumbnail)
- Wikidata entity image (P18 -> Wikimedia Commons URL)
- Discogs (artist search; requires DISCOGS_TOKEN env var)
- Deezer public search (artist pictures)

Outputs JSON files under data/data-sources/image-candidates/<artist_id>.json
and prints a compact console summary.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

SHS_API = "https://api.secondhandsongs.com"
MB_API = "https://musicbrainz.org/ws/2"
WIKI_API = "https://en.wikipedia.org/api/rest_v1/page/summary"
WIKIDATA_ENTITY = "https://www.wikidata.org/wiki/Special:EntityData"
DISCOGS_SEARCH = "https://api.discogs.com/database/search"
DEEZER_SEARCH = "https://api.deezer.com/search/artist"

UA = "covers-network-image-prober/1.0 (hermesite@gmail.com)"


def http_json(url: str, headers: dict[str, str] | None = None, timeout: int = 20) -> Any:
    req_headers = {"User-Agent": UA, "Accept": "application/json"}
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(url, headers=req_headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = resp.read().decode("utf-8")
        return json.loads(payload)


def probe_url(url: str, timeout: int = 12) -> dict[str, Any]:
    result = {"url": url, "ok": False, "status": None, "contentType": None, "error": None}
    if not url:
        result["error"] = "empty-url"
        return result

    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            result["status"] = resp.status
            result["contentType"] = resp.headers.get("Content-Type")
            result["ok"] = 200 <= resp.status < 300
            return result
    except Exception:
        pass

    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            result["status"] = resp.status
            result["contentType"] = resp.headers.get("Content-Type")
            result["ok"] = 200 <= resp.status < 300
            return result
    except urllib.error.HTTPError as exc:
        result["status"] = exc.code
        result["error"] = f"HTTP {exc.code}"
    except Exception as exc:  # noqa: BLE001
        result["error"] = str(exc)

    return result


def commons_image_url(filename: str) -> str:
    # https://commons.wikimedia.org/wiki/Special:FilePath/<filename>
    # Stable direct path form
    safe_name = filename.replace(" ", "_")
    md5 = hashlib.md5(safe_name.encode("utf-8")).hexdigest()
    return f"https://upload.wikimedia.org/wikipedia/commons/{md5[0]}/{md5[0:2]}/{urllib.parse.quote(safe_name)}"


def parse_artist_options(js_path: Path) -> list[dict[str, Any]]:
    src = js_path.read_text(encoding="utf-8")
    pattern = re.compile(r"\{\s*id:\s*(\d+)\s*,\s*name:\s*\"([^\"]+)\"\s*\}")
    artists = []
    for m in pattern.finditer(src):
        artists.append({"id": int(m.group(1)), "name": m.group(2)})
    return artists


def probe_secondhandsongs(artist_id: int) -> dict[str, Any]:
    out: dict[str, Any] = {"source": "secondhandsongs", "ok": False}
    try:
        data = http_json(f"{SHS_API}/artist/{artist_id}")
        picture = data.get("picture")
        out.update(
            {
                "ok": True,
                "artistName": data.get("commonName") or data.get("name"),
                "picture": picture,
                "pictureProbe": probe_url(picture) if picture else None,
            }
        )
    except Exception as exc:  # noqa: BLE001
        out["error"] = str(exc)
    return out


def probe_musicbrainz_and_wiki(artist_name: str) -> dict[str, Any]:
    out: dict[str, Any] = {"source": "musicbrainz", "ok": False}
    try:
        q = urllib.parse.quote(artist_name)
        search = http_json(f"{MB_API}/artist/?query=artist:{q}&fmt=json")
        items = search.get("artists", [])
        if not items:
            out["error"] = "no-musicbrainz-match"
            return out

        top = items[0]
        mbid = top.get("id")
        out.update({"ok": True, "mbid": mbid, "score": top.get("score"), "matchedName": top.get("name")})

        details = http_json(f"{MB_API}/artist/{mbid}?inc=url-rels&fmt=json") if mbid else {}
        rels = details.get("relations", [])

        wiki_url = None
        wikidata_url = None
        for rel in rels:
            if rel.get("type") == "wikipedia":
                wiki_url = (rel.get("url") or {}).get("resource")
            if rel.get("type") == "wikidata":
                wikidata_url = (rel.get("url") or {}).get("resource")

        out["wikipediaRelation"] = wiki_url
        out["wikidataRelation"] = wikidata_url

        if wiki_url and "wikipedia.org/wiki/" in wiki_url:
            title = wiki_url.split("/wiki/", 1)[1]
            summary = http_json(f"{WIKI_API}/{title}")
            thumb = (summary.get("thumbnail") or {}).get("source")
            original = (summary.get("originalimage") or {}).get("source")
            out["wikipediaThumbnail"] = thumb
            out["wikipediaOriginal"] = original
            out["wikipediaThumbnailProbe"] = probe_url(thumb) if thumb else None
            out["wikipediaOriginalProbe"] = probe_url(original) if original else None

        if wikidata_url and "/wiki/" in wikidata_url:
            qid = wikidata_url.rsplit("/", 1)[-1]
            entity = http_json(f"{WIKIDATA_ENTITY}/{qid}.json")
            claims = (((entity.get("entities") or {}).get(qid) or {}).get("claims") or {})
            p18 = claims.get("P18", [])
            if p18:
                filename = (((p18[0].get("mainsnak") or {}).get("datavalue") or {}).get("value"))
                if filename:
                    commons = commons_image_url(filename)
                    out["wikidataImage"] = commons
                    out["wikidataImageProbe"] = probe_url(commons)
    except Exception as exc:  # noqa: BLE001
        out["error"] = str(exc)

    return out


def probe_discogs(artist_name: str) -> dict[str, Any]:
    out: dict[str, Any] = {"source": "discogs", "ok": False}
    token = os.environ.get("DISCOGS_TOKEN")
    if not token:
        out["error"] = "missing-DISCOGS_TOKEN"
        return out

    try:
        q = urllib.parse.quote(artist_name)
        url = f"{DISCOGS_SEARCH}?q={q}&type=artist&per_page=5&token={urllib.parse.quote(token)}"
        data = http_json(url)
        results = data.get("results", [])
        out["ok"] = True
        out["matches"] = []
        for item in results[:3]:
            thumb = item.get("thumb")
            cover = item.get("cover_image")
            out["matches"].append(
                {
                    "title": item.get("title"),
                    "thumb": thumb,
                    "thumbProbe": probe_url(thumb) if thumb else None,
                    "coverImage": cover,
                    "coverProbe": probe_url(cover) if cover else None,
                }
            )
    except Exception as exc:  # noqa: BLE001
        out["error"] = str(exc)

    return out


def probe_deezer(artist_name: str) -> dict[str, Any]:
    out: dict[str, Any] = {"source": "deezer", "ok": False}
    try:
        q = urllib.parse.quote(artist_name)
        data = http_json(f"{DEEZER_SEARCH}?q={q}")
        items = data.get("data", [])
        out["ok"] = True
        out["matches"] = []
        for item in items[:3]:
            out["matches"].append(
                {
                    "name": item.get("name"),
                    "picture": item.get("picture"),
                    "pictureMedium": item.get("picture_medium"),
                    "pictureXl": item.get("picture_xl"),
                    "pictureProbe": probe_url(item.get("picture_xl") or item.get("picture_medium") or item.get("picture")),
                }
            )
    except Exception as exc:  # noqa: BLE001
        out["error"] = str(exc)

    return out


def run_for_artist(artist_id: int, artist_name: str, out_dir: Path) -> Path:
    payload = {
        "artist": {"id": artist_id, "name": artist_name},
        "generatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "sources": {
            "secondhandsongs": probe_secondhandsongs(artist_id),
            "musicbrainz_wikipedia_wikidata": probe_musicbrainz_and_wiki(artist_name),
            "discogs": probe_discogs(artist_name),
            "deezer": probe_deezer(artist_name),
        },
    }

    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{artist_id}.json"
    out_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return out_file


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe multiple image sources for artists")
    parser.add_argument("--artist-id", type=int, default=None)
    parser.add_argument("--artist-name", type=str, default=None)
    parser.add_argument(
        "--from-options",
        action="store_true",
        help="Use secondhand-covers/src/constants/artistOptions.js artist list",
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[2]
    options_path = root / "secondhand-covers" / "src" / "constants" / "artistOptions.js"
    out_dir = root / "data" / "data-sources" / "image-candidates"

    artists: list[dict[str, Any]] = []
    if args.from_options:
        artists = parse_artist_options(options_path)
    elif args.artist_id and args.artist_name:
        artists = [{"id": args.artist_id, "name": args.artist_name}]
    else:
        parser.error("Use --from-options or both --artist-id and --artist-name")

    print(f"Probing image sources for {len(artists)} artist(s)")
    for artist in artists:
        aid = int(artist["id"])
        name = str(artist["name"])
        print(f"\n[{aid}] {name}")
        out_file = run_for_artist(aid, name, out_dir)
        print(f"  wrote: {out_file}")

    print("\nDone.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
