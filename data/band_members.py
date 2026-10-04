"""Extract explicit membership evidence from Discogs artist profiles."""

from __future__ import annotations

import re
import hashlib
from pathlib import Path
from typing import Callable
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from uuid import UUID

from artwork_sources import relation_image

MONTHS = {name: index for index, name in enumerate((
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
), 1)}
MONTH_PATTERN = "|".join(MONTHS)
DATE_PATTERN = re.compile(rf"(?:(?P<month>{MONTH_PATTERN})(?:/(?P<last_month>{MONTH_PATTERN}))?\s+)?(?P<year>\b(?:19|20)\d{{2}}\b)", re.I)
ROLE_PATTERNS = {
    "vocals": r"\bvocals?\b",
    "guitar": r"\bguitar\b",
    "bass guitar": r"\bbass\b",
    "drums": r"\bdrums?\b",
    "castanets": r"\bcastanets\b",
}


def identity_key(name: str) -> str:
    name = re.sub(r"\s+\(\d+\)$", "", name)
    name = re.sub(r'["“][^"”]+["”]', "", name)
    return "".join(character for character in name.casefold() if character.isalnum())


def profile_memberships(artist: dict) -> list[dict]:
    entries = []
    for line in artist.get("profile", "").splitlines():
        if not line.strip().startswith("*"):
            continue
        text = re.sub(r"\[a=([^\]]+)\]", r"\1", line.strip().lstrip("*").strip())
        dates = list(DATE_PATTERN.finditer(text))
        if not dates:
            continue
        heading = text[:dates[0].start()].rstrip(" ,.-–")
        parts = re.split(r"\s+[–-]\s+", heading, maxsplit=1)
        if len(parts) == 2:
            name, role_text = parts
        elif "castanets" in heading.casefold():
            name, role_text = re.split(r"\s+(?=castanets)", heading, maxsplit=1, flags=re.I)
        else:
            continue
        aliases = re.findall(r"\(([^)]+)\)", name)
        name = re.sub(r"\s*\([^)]*\)", "", name)
        name = re.sub(r'"[^\"]*"', "", name).strip()
        roles = [role for role, pattern in ROLE_PATTERNS.items() if re.search(pattern, role_text, re.I)]
        linked_names = re.findall(r"\[a=([^\]]+)\]", line)

        def date_value(match: re.Match, last: bool = False) -> str:
            month = match.group("last_month") if last and match.group("last_month") else match.group("month")
            return match.group("year") + (f"-{MONTHS[month.title()]:02d}" if month else "")

        periods = []
        index = 0
        while index < len(dates):
            start = dates[index]
            if index + 1 < len(dates) and re.fullmatch(r"\s*(?:[–-]|to)\s*", text[start.end():dates[index + 1].start()], re.I):
                end = dates[index + 1]
                periods.append({"begin": date_value(start), "end": date_value(end, True)})
                index += 2
            else:
                periods.append({"begin": date_value(start), "end": date_value(start, True)})
                index += 1
        entries.append({
            "name": name,
            "aliases": aliases + linked_names,
            "roles": roles,
            "periods": periods,
            "evidence": line.strip(),
        })
    return entries


def membership_match(entry: dict, person: dict, discogs: dict, identities: dict) -> bool:
    names = {identity_key(name) for name in [entry["name"], *entry["aliases"]]}
    if identity_key(person["name"]) in names:
        return True
    discogs_id = identities.get(person["id"])
    return any(member["id"] == discogs_id and identity_key(member["name"]) in names
               for member in discogs.get("members", []))


def enrich_memberships(band: dict, discogs: dict, identities: dict | None = None) -> list[dict]:
    originals = [relation for relation in band.get("relations", [])
                 if relation.get("type") == "member of band" and relation.get("direction") == "backward"]
    identities = identities or {}
    enriched = []
    consumed = set()
    source_url = f"https://www.discogs.com/artist/{discogs['id']}"
    for entry in profile_memberships(discogs):
        matches = [(index, relation) for index, relation in enumerate(originals)
                   if membership_match(entry, relation["artist"], discogs, identities)]
        matched_people = {relation["artist"]["id"] for _, relation in matches}
        if len(matched_people) > 1:
            continue
        names = {identity_key(name) for name in [entry["name"], *entry["aliases"]]}
        discogs_person = next((member for member in discogs.get("members", [])
                               if identity_key(member["name"]) in names), None)
        for period in entry["periods"]:
            overlapping = [(index, relation) for index, relation in matches
                           if (not relation.get("begin") or relation["begin"][:4] <= period["end"][:4])
                           and (not relation.get("end") or relation["end"][:4] >= period["begin"][:4])]
            if overlapping:
                index, original = overlapping[0]
                consumed.add(index)
            else:
                original = None
            if original:
                relation = {**original}
                relation["musicbrainzMembership"] = {
                    "begin": original.get("begin"), "end": original.get("end"),
                    "attributes": original.get("attributes", []),
                }
            else:
                person = matches[0][1]["artist"] if matches else {
                    "id": f"discogs:{discogs_person['id']}" if discogs_person else f"discogs-profile:{identity_key(entry['name'])}",
                    "name": entry["name"], "type": "Person",
                    "url": f"https://www.discogs.com/artist/{discogs_person['id']}" if discogs_person else source_url,
                }
                relation = {"type": "member of band", "direction": "backward", "target-type": "artist", "artist": person}
            notes = []
            date_sources = {}
            for field in ("begin", "end"):
                recorded = relation.get(field)
                supplied = period[field]
                if not recorded or supplied.startswith(recorded):
                    relation[field] = supplied
                    date_sources[field] = "MusicBrainz + Discogs" if recorded == supplied else "Discogs"
                else:
                    date_sources[field] = "MusicBrainz"
                    notes.append(f"{field.title()} differs: MusicBrainz {recorded}; Discogs {supplied}.")
            attributes = list(relation.get("attributes", []))
            if not [attribute for attribute in attributes if attribute not in ("original", "guest", "additional")]:
                attributes.extend(entry["roles"])
            relation["attributes"] = attributes
            relation["ended"] = True
            relation["membershipSources"] = ([{
                "name": "MusicBrainz", "url": f"https://musicbrainz.org/artist/{band['id']}/relationships",
            }] if original else []) + [{
                "name": "Discogs", "url": source_url,
                "begin": period["begin"], "end": period["end"],
                "roles": entry["roles"], "evidence": entry["evidence"],
            }]
            band_begin = band.get("life-span", {}).get("begin")
            if band_begin and period["begin"][:4] < band_begin[:4]:
                notes.append(f"Discogs begins {period['begin']}, before the band's recorded formation in {band_begin}; chart clipped to band activity.")
            relation["membershipDateSources"] = date_sources
            relation["membershipNotes"] = notes
            enriched.append(relation)
    enriched.extend({**relation, "membershipSources": [{
        "name": "MusicBrainz", "url": f"https://musicbrainz.org/artist/{band['id']}/relationships",
    }]} for index, relation in enumerate(originals) if index not in consumed)
    return enriched


def member_of_relationships(person: dict) -> list[dict]:
    relationships = []
    seen = set()
    for relation in person.get("relations", []):
        target = relation.get("artist") or {}
        if relation.get("type") != "member of band" or relation.get("direction") != "forward" or not target.get("id"):
            continue
        key = (target["id"], relation.get("begin"), relation.get("end"), tuple(relation.get("attributes", [])))
        if key in seen:
            continue
        seen.add(key)
        relationships.append({
            "id": target["id"], "name": target["name"],
            "url": f"https://musicbrainz.org/artist/{target['id']}",
            "begin": relation.get("begin"), "end": relation.get("end"),
            "ended": relation.get("ended", False), "roles": relation.get("attributes", []),
        })
    return sorted(relationships, key=lambda relation: (relation["name"].casefold(), relation["begin"] or ""))


def discogs_member_of(person: dict, fetch: Callable[[str, str], dict]) -> dict:
    records = [person]
    errors = []
    seen_artists = {person["id"]}
    for alias in person.get("aliases", []):
        if alias["id"] in seen_artists:
            continue
        seen_artists.add(alias["id"])
        try:
            record = fetch(f"https://api.discogs.com/artists/{alias['id']}", f"discogs-member-{alias['id']}")
            if record.get("id") != alias["id"]:
                raise ValueError("Discogs returned an unexpected alias identity")
            records.append(record)
        except (URLError, TimeoutError, OSError, ValueError) as exc:
            errors.append(f"{alias.get('name', alias['id'])}: {exc}")
    groups = {}
    sources = []
    for record in records:
        source = {"id": record["id"], "name": record.get("name", str(record["id"])), "url": f"https://www.discogs.com/artist/{record['id']}"}
        sources.append(source)
        for group in record.get("groups", []):
            group_id = group.get("id")
            if not group_id or not group.get("name"):
                continue
            if group_id not in groups:
                groups[group_id] = {"id": f"discogs:{group_id}", "name": group["name"],
                                    "url": f"https://www.discogs.com/artist/{group_id}", "source": "Discogs", "listings": []}
            groups[group_id]["listings"].append({**source, "active": group.get("active")})
    return {"items": sorted(groups.values(), key=lambda group: group["name"].casefold()),
            "sources": sources, "errors": errors, "status": "partial" if errors else "complete"}


def save_member_image(image_url: str, member_id: str, output_dir: Path) -> str | None:
    filename = hashlib.sha256(member_id.encode()).hexdigest()[:20]
    for extension in ("jpg", "png", "webp", "gif"):
        existing = output_dir / f"{filename}.{extension}"
        if existing.exists():
            return f"/images/members/{existing.name}"
    try:
        request = Request(image_url, headers={"User-Agent": "CoversRelationships/1.0 (member portraits)"})
        with urlopen(request, timeout=20) as response:
            extension = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}.get(response.headers.get_content_type())
            content = response.read(10 * 1024 * 1024 + 1)
        if extension is None or len(content) > 10 * 1024 * 1024:
            return None
        output_dir.mkdir(parents=True, exist_ok=True)
        image_path = output_dir / f"{filename}.{extension}"
        image_path.write_bytes(content)
        return f"/images/members/{image_path.name}"
    except (URLError, TimeoutError, OSError, ValueError):
        return None


def enrich_member_details(band: dict, memberships: list[dict], discogs: dict,
                          fetch: Callable[[str, str], dict], image_dir: Path,
                          use_discogs: bool = True) -> list[dict]:
    people = {relation["artist"]["id"]: relation["artist"] for relation in memberships}
    entries = profile_memberships(discogs)
    output = []
    for member_id, person in people.items():
        card = {"id": member_id, "name": person["name"], "memberOf": [], "memberOfStatus": "not-linked", "imageUrl": None,
            "memberOfSource": "MusicBrainz", "discogsMemberOfStatus": "disabled" if not use_discogs else "not-linked"}
        names = {identity_key(person["name"])}
        for entry in entries:
            if identity_key(entry["name"]) in names:
                names.update(identity_key(name) for name in entry["aliases"])
        discogs_person = next((member for member in discogs.get("members", []) if identity_key(member["name"]) in names), None)
        discogs_id = int(member_id.split(":", 1)[1]) if member_id.startswith("discogs:") else (discogs_person or {}).get("id")
        discogs_details = {}
        discogs_ids = {discogs_id} if discogs_id else set()
        search_names = {person["name"]}
        if discogs_id and use_discogs:
            try:
                discogs_details = fetch(f"https://api.discogs.com/artists/{discogs_id}", f"discogs-member-{discogs_id}")
                aliases = discogs_details.get("aliases", [])
                discogs_ids.update(alias["id"] for alias in aliases)
                search_names.update(alias["name"] for alias in aliases)
                search_names.update(discogs_details.get("namevariations", []))
                if discogs_details.get("realname"):
                    search_names.add(discogs_details["realname"])
                names.update(identity_key(name) for name in search_names)
            except (URLError, TimeoutError, OSError, ValueError) as exc:
                card["imageError"] = str(exc)
        details = None
        try:
            try:
                mbid = str(UUID(member_id))
            except ValueError:
                mbid = None
            if mbid:
                details = fetch(f"https://musicbrainz.org/ws/2/artist/{mbid}?inc=artist-rels+url-rels+aliases&fmt=json", f"member-full-{mbid}")
                if details.get("id") != mbid:
                    raise ValueError("MusicBrainz returned an unexpected member identity")
            else:
                search_query = " OR ".join(f'artist:"{name.replace(chr(34), "")}"' for name in sorted(search_names))
                query = urlencode({"query": search_query, "fmt": "json", "limit": 10})
                search_key = hashlib.sha256(query.encode()).hexdigest()[:20]
                results = fetch(f"https://musicbrainz.org/ws/2/artist/?{query}", f"member-search-{search_key}")
                verified = []
                for candidate in results.get("artists", []):
                    candidate_names = {identity_key(candidate.get("name", ""))}
                    candidate_names.update(identity_key(alias["name"]) for alias in candidate.get("aliases", []))
                    if not names.intersection(candidate_names) or candidate.get("type") not in (None, "Person"):
                        continue
                    candidate_id = candidate["id"]
                    candidate_details = fetch(f"https://musicbrainz.org/ws/2/artist/{candidate_id}?inc=artist-rels+url-rels+aliases&fmt=json", f"member-full-{candidate_id}")
                    groups = member_of_relationships(candidate_details)
                    urls = [(relation.get("url") or {}).get("resource", "") for relation in candidate_details.get("relations", [])]
                    has_discogs_identity = any(re.search(rf"discogs\.com/artist/{identity}(?:\D|$)", url)
                                               for identity in discogs_ids for url in urls)
                    if any(group["id"] == band["id"] for group in groups) or has_discogs_identity:
                        verified.append(candidate_details)
                if len(verified) == 1:
                    details = verified[0]
            if details:
                card.update({"musicbrainzId": details["id"], "musicbrainzUrl": f"https://musicbrainz.org/artist/{details['id']}",
                             "memberOf": member_of_relationships(details), "memberOfStatus": "complete"})
                for relation in details.get("relations", []):
                    match = re.match(r"https?://(?:www\.)?discogs\.com/artist/(\d+)", (relation.get("url") or {}).get("resource", ""))
                    if match and discogs_id is None:
                        discogs_id = int(match.group(1))
                        break
        except (URLError, TimeoutError, OSError, ValueError) as exc:
            card.update({"memberOfStatus": "unavailable", "memberOfError": str(exc)})

        if discogs_id and use_discogs:
            try:
                if not discogs_details:
                    discogs_details = fetch(f"https://api.discogs.com/artists/{discogs_id}", f"discogs-member-{discogs_id}")
                images = sorted(discogs_details.get("images", []), key=lambda image: image.get("type") != "primary")
                for image in images:
                    image_url = image.get("uri") or image.get("uri150")
                    if image_url:
                        card["imageUrl"] = save_member_image(image_url, member_id, image_dir)
                        if card["imageUrl"]:
                            card["imageSource"] = {"name": "Discogs", "url": f"https://www.discogs.com/artist/{discogs_id}"}
                            break
            except (URLError, TimeoutError, OSError, ValueError) as exc:
                card["imageError"] = str(exc)
            if not card["imageUrl"] and discogs_person and discogs_person.get("thumbnail_url"):
                card["imageUrl"] = save_member_image(discogs_person["thumbnail_url"], member_id, image_dir)
                if card["imageUrl"]:
                    card["imageSource"] = {"name": "Discogs", "url": f"https://www.discogs.com/artist/{discogs_person['id']}"}
        if not card["imageUrl"] and details:
            image_url = relation_image(details.get("relations", []))
            if image_url:
                card["imageUrl"] = save_member_image(image_url, member_id, image_dir)
                if card["imageUrl"]:
                    card["imageSource"] = {"name": "Wikimedia / Wikipedia", "url": image_url}
        card["musicbrainzMemberOf"] = card["memberOf"]
        card["musicbrainzMemberOfStatus"] = card["memberOfStatus"]
        if use_discogs and discogs_id:
            card["discogsUrl"] = f"https://www.discogs.com/artist/{discogs_id}"
            if discogs_details:
                if discogs_details.get("id") == discogs_id:
                    groups = discogs_member_of(discogs_details, fetch)
                    card.update({"discogsMemberOf": groups["items"], "discogsMemberOfStatus": groups["status"],
                                 "discogsMembershipSources": groups["sources"], "discogsMemberOfErrors": groups["errors"]})
                    if groups["items"] or not card["memberOf"]:
                        card.update({"memberOf": groups["items"], "memberOfSource": "Discogs", "memberOfStatus": groups["status"]})
                else:
                    card.update({"discogsMemberOfStatus": "unavailable", "discogsMemberOfErrors": ["Discogs returned an unexpected artist identity"]})
            else:
                card.update({"discogsMemberOfStatus": "unavailable", "discogsMemberOfErrors": [card.get("imageError", "Discogs artist unavailable")]})
        output.append(card)
        print(f"Member details: {person['name']} - {len(card['memberOf'])} membership(s), photo {'saved' if card['imageUrl'] else 'unavailable'}")
    return output