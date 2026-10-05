import copy
import io
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.error import URLError

from band_members import build_band_family_network, discogs_member_of, enrich_member_details, enrich_memberships, member_of_relationships, profile_memberships
from band_releases import discogs_release_annotation, discogs_release_annotations, release_annotations
from generate_band_detail import CRAMPS_MBID, main


class BandMembershipTests(unittest.TestCase):
    def setUp(self):
        self.band = {
            "id": "band-id", "life-span": {"begin": "1976", "end": "2009"},
            "relations": [{
                "type": "member of band", "direction": "backward", "target-type": "artist",
                "artist": {"id": "member-id", "name": "Miriam Linna"},
                "begin": "1976", "end": "1977", "attributes": [],
            }],
        }
        self.discogs = {
            "id": 39779, "members": [],
            "profile": "* [a=Miriam Linna] - drums, October 1976 - June 1977",
        }

    def test_band_family_network_joins_aliases_and_adds_full_external_roster(self):
        person_id = "member-mbid"
        memberships = [{"artist": {"id": person_id, "name": "Band Member"}, "begin": "1980", "ended": True, "attributes": ["guitar"]}]
        details = [{
            "id": person_id,
            "name": "Band Member",
            "discogsUrl": "https://www.discogs.com/artist/100",
            "discogsMembershipSources": [{"id": 100, "name": "Alias", "url": "https://www.discogs.com/artist/100"}],
            "memberOf": [{"id": "discogs:200", "name": "Other Band", "url": "https://www.discogs.com/artist/200"}],
        }]

        def fetch(url, _key):
            self.assertEqual(url, "https://api.discogs.com/artists/200")
            return {"id": 200, "name": "Other Band", "members": [
                {"id": 100, "name": "Alias", "active": False},
                {"id": 101, "name": "Other Artist", "active": True},
            ]}

        graph = build_band_family_network({"id": "band-mbid", "name": "The Cramps"}, memberships, details,
                                          {"id": 39779}, fetch)
        nodes = {node["id"]: node for node in graph["nodes"]}
        edges = {(edge["source"], edge["target"]): edge for edge in graph["edges"]}
        member_node = "artist:member-mbid"
        other_node = "artist:discogs:101"
        central_node = "band:discogs:39779"
        other_band_node = "band:discogs:200"
        self.assertEqual(graph["status"], "complete")
        self.assertEqual(graph["groupsFetched"], 1)
        self.assertEqual(nodes[member_node]["name"], "Band Member")
        self.assertEqual(nodes[other_node]["name"], "Other Artist")
        self.assertTrue(nodes[member_node]["selectedBandMember"])
        self.assertIn((member_node, central_node), edges)
        self.assertIn((member_node, other_band_node), edges)
        self.assertFalse(edges[(member_node, other_band_node)]["active"])
        self.assertIn((other_node, other_band_node), edges)

    def test_band_family_network_preserves_partial_graph_when_roster_fetch_fails(self):
        member = {"artist": {"id": "member-mbid", "name": "Band Member"}}
        details = [{"id": "member-mbid", "memberOf": [{"id": "discogs:200", "name": "Other Band"}]}]
        graph = build_band_family_network({"id": "band-mbid", "name": "The Cramps"}, [member], details,
                                          {"id": 39779}, lambda _url, _key: (_ for _ in ()).throw(URLError("offline")))
        self.assertEqual(graph["status"], "partial")
        self.assertEqual(graph["groupsFetched"], 0)
        self.assertEqual(len(graph["errors"]), 1)
        self.assertIn("band:discogs:200", {node["id"] for node in graph["nodes"]})
        self.assertIn("band:discogs:39779", {node["id"] for node in graph["nodes"]})

    def test_months_and_multiple_tenures(self):
        self.discogs["profile"] = (
            "* [a=Mike Metoff] - guitar, October 1983 - November 1983; January 1984 - July 1984\n"
            "* [a=Sean Yseult] - bass, October/November 2006\n"
            "* Jen Hanrahan - castanets June 2000 - August 2000.\n"
            '* "Jungle" [a=Jim Chandler] - "Laid down the primal beat" for the European tour 2004'
        )
        entries = profile_memberships(self.discogs)
        self.assertEqual(entries[0]["periods"], [
            {"begin": "1983-10", "end": "1983-11"}, {"begin": "1984-01", "end": "1984-07"},
        ])
        self.assertEqual(entries[1]["periods"], [{"begin": "2006-10", "end": "2006-11"}])
        self.assertEqual(entries[2]["roles"], ["castanets"])
        self.assertEqual(entries[3]["name"], "Jim Chandler")
        self.assertEqual(entries[3]["roles"], [])

    def test_member_of_excludes_incoming_and_unrelated_relationships(self):
        relation = {"type": "member of band", "direction": "forward", "artist": {"id": "group-id", "name": "Another Band"}, "begin": "1980", "end": "1985"}
        details = {"relations": [relation, relation.copy(), {**relation, "direction": "backward"}, {**relation, "type": "collaboration"}]}
        relationships = member_of_relationships(details)
        self.assertEqual(len(relationships), 1)
        self.assertEqual(relationships[0]["name"], "Another Band")
        self.assertEqual(relationships[0]["begin"], "1980")

    def test_discogs_groups_include_aliases_and_deduplicate_ids_without_inventing_dates(self):
        person = {"id": 1, "name": "Real Name", "groups": [{"id": 10, "name": "Band", "active": False}],
                  "aliases": [{"id": 2, "name": "Stage Name"}, {"id": 2, "name": "Stage Name"}]}
        calls = []

        def fetch(url, key):
            calls.append(url)
            return {"id": 2, "name": "Stage Name", "groups": [{"id": 10, "name": "Band", "active": True}, {"id": 11, "name": "Project"}]}

        result = discogs_member_of(person, fetch)
        self.assertEqual(len(calls), 1)
        self.assertEqual(len(result["items"]), 2)
        self.assertEqual(len(result["items"][0]["listings"]), 2)
        self.assertNotIn("begin", result["items"][0])
        self.assertTrue(all(group["url"].startswith("https://www.discogs.com/artist/") for group in result["items"]))

    def test_discogs_alias_failure_preserves_available_groups(self):
        person = {"id": 1, "groups": [{"id": 10, "name": "Band"}], "aliases": [{"id": 2, "name": "Alias"}]}

        def fetch(url, key):
            raise URLError("Alias unavailable")

        result = discogs_member_of(person, fetch)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["items"][0]["name"], "Band")
        self.assertTrue(result["errors"])

    def test_member_details_deduplicates_returning_member_and_preserves_outgoing_groups(self):
        member_id = "58856f5c-0589-4811-9441-c08a077d4bd9"
        relation = copy.deepcopy(self.band["relations"][0])
        relation["artist"]["id"] = member_id
        details = {"id": member_id, "relations": [{"type": "member of band", "direction": "forward", "artist": {"id": "other-group", "name": "Other Band"}}]}
        with TemporaryDirectory() as output:
            with patch("band_members.relation_image", return_value=None):
                with redirect_stdout(io.StringIO()):
                    cards = enrich_member_details(self.band, [relation, relation.copy()], {}, lambda url, key: details, Path(output))
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]["memberOf"][0]["name"], "Other Band")
        self.assertEqual(cards[0]["memberOfStatus"], "complete")

    def test_discogs_alias_verifies_musicbrainz_identity(self):
        relation = copy.deepcopy(self.band["relations"][0])
        relation["artist"] = {"id": "discogs:2917374", "name": "Sean Yseult"}
        person_id = "b69b4e8f-5346-413f-97b9-f13f1507a879"

        def fetch(url, key):
            if "api.discogs.com" in url:
                return {"id": 2917374, "aliases": [{"id": 528892, "name": "Sean Yseult"}]}
            if "/artist/?" in url:
                return {"artists": [{"id": person_id, "name": "Sean Yseult", "type": "Person"}]}
            return {"id": person_id, "relations": [
                {"type": "discogs", "url": {"resource": "https://www.discogs.com/artist/528892"}},
                {"type": "member of band", "direction": "forward", "artist": {"id": "other-band", "name": "White Zombie"}},
            ]}

        with TemporaryDirectory() as output:
            with patch("band_members.relation_image", return_value=None):
                with redirect_stdout(io.StringIO()):
                    cards = enrich_member_details(self.band, [relation], {}, fetch, Path(output))
        self.assertEqual(cards[0]["musicbrainzId"], person_id)
        self.assertEqual(cards[0]["memberOf"][0]["name"], "White Zombie")

    def test_discogs_is_primary_and_musicbrainz_is_retained(self):
        relation = copy.deepcopy(self.band["relations"][0])
        relation["artist"] = {"id": "discogs:123", "name": "A Member"}
        person_id = "b69b4e8f-5346-413f-97b9-f13f1507a879"

        def fetch(url, key):
            if "api.discogs.com" in url:
                return {"id": 123, "name": "A Member", "groups": [{"id": 456, "name": "Discogs Project"}]}
            if "/artist/?" in url:
                return {"artists": [{"id": person_id, "name": "A Member", "type": "Person"}]}
            return {"id": person_id, "relations": [
                {"type": "discogs", "url": {"resource": "https://www.discogs.com/artist/123"}},
                {"type": "member of band", "direction": "forward", "artist": {"id": "group", "name": "MusicBrainz Band"}},
            ]}

        with TemporaryDirectory() as output:
            with patch("band_members.relation_image", return_value=None), redirect_stdout(io.StringIO()):
                cards = enrich_member_details(self.band, [relation], {}, fetch, Path(output))
        self.assertEqual(cards[0]["memberOfSource"], "Discogs")
        self.assertEqual(cards[0]["memberOf"][0]["name"], "Discogs Project")
        self.assertEqual(cards[0]["musicbrainzMemberOf"][0]["name"], "MusicBrainz Band")

    def test_same_name_without_identity_evidence_is_not_linked(self):
        relation = copy.deepcopy(self.band["relations"][0])
        relation["artist"] = {"id": "discogs:123", "name": "A Common Name"}
        person_id = "b69b4e8f-5346-413f-97b9-f13f1507a879"

        def fetch(url, key):
            if "api.discogs.com" in url:
                return {"id": 123}
            if "/artist/?" in url:
                return {"artists": [{"id": person_id, "name": "A Common Name", "type": "Person"}]}
            return {"id": person_id, "relations": []}

        with TemporaryDirectory() as output:
            with redirect_stdout(io.StringIO()):
                cards = enrich_member_details(self.band, [relation], {}, fetch, Path(output))
        self.assertEqual(cards[0]["musicbrainzMemberOfStatus"], "not-linked")
        self.assertNotIn("musicbrainzId", cards[0])

    def test_refines_dates_without_mutating_source(self):
        original = copy.deepcopy(self.band)
        enriched = enrich_memberships(self.band, self.discogs)
        self.assertEqual(self.band, original)
        self.assertEqual(enriched[0]["begin"], "1976-10")
        self.assertEqual(enriched[0]["end"], "1977-06")
        self.assertEqual(enriched[0]["attributes"], ["drums"])
        self.assertEqual(enriched[0]["musicbrainzMembership"]["begin"], "1976")
        self.assertEqual(len(enriched[0]["membershipSources"]), 2)

    def test_preserves_conflicting_precise_date_and_role(self):
        self.band["relations"][0].update({"begin": "1976-09", "attributes": ["membranophone"]})
        enriched = enrich_memberships(self.band, self.discogs)
        self.assertEqual(enriched[0]["begin"], "1976-09")
        self.assertEqual(enriched[0]["attributes"], ["membranophone"])
        self.assertIn("Discogs 1976-10", enriched[0]["membershipNotes"][0])

    def test_verified_alias_does_not_duplicate_member(self):
        self.band["relations"][0]["artist"]["name"] = "Timothy Maag"
        self.band["relations"][0].update({"begin": None, "end": None})
        self.discogs.update({
            "members": [{"id": 1021860, "name": "Tim Maag"}],
            "profile": "* Touch Hazard ([a=Tim Maag] of The Mechanics) - bass, 1985",
        })
        enriched = enrich_memberships(self.band, self.discogs, {"member-id": 1021860})
        self.assertEqual(len(enriched), 1)
        self.assertEqual(enriched[0]["artist"]["name"], "Timothy Maag")
        self.assertEqual(enriched[0]["begin"], "1985")

    def test_unknown_dates_can_be_split_and_preformation_dates_are_not_hidden(self):
        self.band["relations"][0].update({"begin": None, "end": None})
        self.discogs["profile"] = "* [a=Miriam Linna] - drums, March 1973 - June 1977 and July 1980 - September 1980"
        enriched = enrich_memberships(self.band, self.discogs)
        self.assertEqual(len(enriched), 2)
        self.assertEqual(enriched[0]["begin"], "1973-03")
        self.assertIn("before the band's recorded formation", enriched[0]["membershipNotes"][0])
        self.assertEqual(enriched[1]["begin"], "1980-07")

    def test_discogs_failure_preserves_musicbrainz_memberships(self):
        band = {**self.band, "id": CRAMPS_MBID}
        with TemporaryDirectory() as output:
            with patch("sys.argv", ["generate_band_detail.py", "--output", output, "--discogs-id", "39779", "--skip-member-details", "--skip-releases"]):
                with patch("generate_band_detail.fetch_cached", side_effect=[band, URLError("Discogs unavailable")]), patch("generate_band_detail.write_json") as write:
                    with redirect_stdout(io.StringIO()):
                        self.assertEqual(main(), 0)
            write.assert_called_once()
            self.assertEqual(write.call_args.args[0], (Path(output) / "14076.json").resolve())
            payload = write.call_args.args[1]
        self.assertEqual(payload["memberships"], band["relations"])
        self.assertEqual(payload["membershipEnrichment"]["status"], "unavailable")
        self.assertIn("Discogs unavailable", payload["membershipEnrichment"]["error"])

    def test_release_failure_does_not_discard_band_data(self):
        band = {**self.band, "id": CRAMPS_MBID}
        with TemporaryDirectory() as output:
            with patch("sys.argv", ["generate_band_detail.py", "--output", output, "--skip-discogs", "--skip-member-details"]):
                with patch("generate_band_detail.fetch_cached", side_effect=[band, URLError("Release API unavailable")]), patch("generate_band_detail.write_json") as write:
                    with redirect_stdout(io.StringIO()):
                        self.assertEqual(main(), 0)
            write.assert_called_once()
            payload = write.call_args.args[1]
        self.assertEqual(payload["memberships"], band["relations"])
        self.assertEqual(payload["releaseAnnotations"]["status"], "unavailable")
        self.assertIn("Release API unavailable", payload["releaseAnnotations"]["error"])

    def test_skip_discogs_makes_no_enrichment_request(self):
        band = {**self.band, "id": CRAMPS_MBID}
        with TemporaryDirectory() as output:
            with patch("sys.argv", ["generate_band_detail.py", "--output", output, "--skip-discogs", "--skip-member-details", "--skip-releases"]):
                with patch("generate_band_detail.fetch_cached", return_value=band) as fetch, patch("generate_band_detail.write_json") as write:
                    with redirect_stdout(io.StringIO()):
                        self.assertEqual(main(), 0)
                    fetch.assert_called_once()
            write.assert_called_once()
            self.assertEqual(write.call_args.args[0], (Path(output) / "14076.json").resolve())
            payload = write.call_args.args[1]
        self.assertEqual(payload["membershipEnrichment"]["status"], "disabled")


class BandReleaseTests(unittest.TestCase):
    def test_discogs_catalog_keeps_main_artist_official_masters_and_deduplicates_editions(self):
        def fetch(url, key):
            if "/artists/39779/releases?" in url:
                return {"pagination": {"pages": 1}, "releases": [
                    {"id": 1, "type": "master", "role": "Main", "year": 1980, "title": "Album"},
                    {"id": 2, "type": "release", "role": "Main", "year": 1990, "title": "Reissue"},
                    {"id": 3, "type": "release", "role": "Main", "year": 1981, "title": "Bootleg"},
                    {"id": 4, "type": "release", "role": "Appearance", "year": 1982, "title": "Various artists"},
                ]}
            if "/masters/1" in url:
                return {"id": 1, "title": "Album", "year": 1980, "main_release": 10}
            release_id = int(url.rsplit("/", 1)[1])
            return {"id": release_id, "title": "Album", "status": "Accepted", "year": 1980,
                    "artists": [{"id": 39779}], "master_id": 1 if release_id == 2 else 0,
                    "formats": [{"descriptions": ["Album", "Unofficial Release"] if release_id == 3 else ["Album"]}]}

        result = discogs_release_annotations(39779, fetch)
        self.assertEqual(result["source"], "Discogs")
        self.assertEqual(result["status"], "complete")
        self.assertEqual(len(result["items"]), 1)
        self.assertEqual(result["items"][0]["id"], "discogs-master:1")
        self.assertEqual(result["excludedCount"], 1)

    def test_discogs_unofficial_releases_are_excluded_even_if_accepted(self):
        release = {"id": 1, "title": "Bootleg", "status": "Accepted", "year": 1980,
                   "formats": [{"descriptions": ["Album", "Unofficial Release"]}]}
        self.assertIsNone(discogs_release_annotation({"year": 1980}, release))

    def test_discogs_master_uses_original_year_and_classifies_live_compilation(self):
        release = {"id": 1, "title": "Reissue", "status": "Accepted", "year": 2010, "released": "2010-01-01",
                   "formats": [{"descriptions": ["Album", "Compilation"]}], "notes": "Recorded live at a concert."}
        master = {"id": 2, "title": "Original Title", "year": 1983}
        annotation = discogs_release_annotation({"year": 1983}, release, master)
        self.assertEqual(annotation["date"], "1983")
        self.assertEqual(annotation["title"], "Original Title")
        self.assertEqual(annotation["secondaryTypes"], ["Compilation", "Live"])
        self.assertEqual(annotation["url"], "https://www.discogs.com/master/2")

    def test_discogs_ep_and_single_formats_are_preserved(self):
        for release_type in ("EP", "Single"):
            release = {"id": 1, "title": "Release", "status": "Accepted", "year": 1980,
                       "formats": [{"descriptions": [release_type]}]}
            self.assertEqual(discogs_release_annotation({}, release)["type"], release_type)

    def test_discogs_compilation_without_album_tag_is_retained_and_classified(self):
        release = {"id": 1, "title": "Compilation", "status": "Accepted", "year": 1983,
                   "formats": [{"descriptions": ["LP", "Compilation"]}]}
        annotation = discogs_release_annotation({}, release)
        self.assertEqual(annotation["type"], "Album")
        self.assertEqual(annotation["secondaryTypes"], ["Compilation"])

    def test_all_types_paginate_and_exclude_missing_dates(self):
        calls = []

        def fetch(url, key):
            calls.append(url)
            if "/release-group?" in url:
                items = [
                    {"id": "album", "title": "Album", "primary-type": "Album", "first-release-date": "1980"},
                    {"id": "ep", "title": "EP", "primary-type": "EP", "first-release-date": "1979-07"},
                ] if "offset=0" in url else [{"id": "single", "title": "Single", "primary-type": "Single", "first-release-date": "1978"}]
                return {"release-group-count": 3, "release-groups": items}
            return {"recording-count": 2, "recordings": [
                {"id": "song", "title": "Song", "first-release-date": "1981-02-03"},
                {"id": "unknown", "title": "Unknown", "disambiguation": "live, 1976"},
            ]}

        result = release_annotations("artist", fetch)
        self.assertEqual(len(calls), 3)
        self.assertEqual({item["type"] for item in result["items"]}, {"Album", "EP", "Single", "Recording"})
        self.assertEqual(result["undatedCount"], 1)
        self.assertEqual(result["items"][0]["year"], 1978)
        self.assertEqual(result["items"][-1]["date"], "1981-02-03")

    def test_incomplete_pagination_is_not_silently_accepted(self):
        with self.assertRaisesRegex(ValueError, "Incomplete"):
            release_annotations("artist", lambda url, key: {"release-group-count": 1, "release-groups": []})


if __name__ == "__main__":
    unittest.main()