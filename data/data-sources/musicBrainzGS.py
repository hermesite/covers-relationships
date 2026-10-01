import musicbrainzngs
from musicbrainzngs import WebServiceError
import json
import os

mb_user = os.environ.get("MUSICBRAINZ_USERNAME")
mb_pass = os.environ.get("MUSICBRAINZ_PASSWORD")
if mb_user and mb_pass:
    musicbrainzngs.auth(mb_user, mb_pass)

# set a proper user-agent with set_useragent("application name", "application version", "contact info (preferably URL or email for your application)"
musicbrainzngs.set_useragent(
    os.environ.get("MUSICBRAINZ_APP_NAME", "HermesiteCovers"),
    os.environ.get("MUSICBRAINZ_APP_VERSION", "0.1"),
    os.environ.get("MUSICBRAINZ_CONTACT", "hermesite@gmail.com"),
)




# artist_id = "c5c2ea1c-4bde-4f4d-bd0b-47b200bf99d6"
# try:
#     result = musicbrainzngs.get_artist_by_id(artist_id)
# except WebServiceError as exc:
#     print("Something went wrong with the request: %s" % exc)
# else:
#     artist = result["artist"]
#     print("name:\t\t%s" % artist["name"])
#     print("sort name:\t%s" % artist["sort-name"])

# Searching for artists
result = musicbrainzngs.search_artists(artist="The Who", type="group",
                                       country="GB")
# for artist in result['artist-list']:
#     print(u"{id}: {name}".format(id=artist['id'], name=artist["name"]))

# Set the first result as the selected artist
selected_artist_id = result['artist-list'][0]['id']
print("Selected artist id:")
print(selected_artist_id)

# Get the selected artist information
selected_artist_information = musicbrainzngs.get_artist_by_id(selected_artist_id)
print("Selected artist information:")
# print the results as formatted json
print(json.dumps(selected_artist_information, sort_keys=True, indent=4))

# Get the selected artist release groups
selected_artist_release_groups = musicbrainzngs.browse_release_groups(selected_artist_id)
print("Selected artist release groups:")
# print the results as formatted json
print(json.dumps(selected_artist_release_groups, sort_keys=True, indent=4))

# Get the works of the first release group (album)
selected_release_group_id = selected_artist_release_groups['release-group-list'][0]['id']
print("Selected release group id (album):")
print(selected_release_group_id)

# Get the selected release group information
selected_release_group_information = musicbrainzngs.get_release_group_by_id(selected_release_group_id)
print("Selected release group information:")
# print the results as formatted json
print(json.dumps(selected_release_group_information, sort_keys=True, indent=4))

# Get the selected release group releases
selected_release_group_releases = musicbrainzngs.browse_releases(release_group= selected_release_group_id)
print("Selected release group releases:")
# print the results as formatted json
print(json.dumps(selected_release_group_releases, sort_keys=True, indent=4))

# Get the list of songs of the first release
selected_release_id = selected_release_group_releases['release-list'][6]['id']
# It should be "My Generation"
print("Selected release id:")
print(selected_release_id)

# Get the selected release information
selected_release_information = musicbrainzngs.get_release_by_id(selected_release_id)
print("Selected release information:")
# print the results as formatted json
print(json.dumps(selected_release_information, sort_keys=True, indent=4))

# Get the selected release recordings
selected_release_recordings = musicbrainzngs.browse_recordings(release= selected_release_id)
print("Selected release recordings:")
# print the results as formatted json
print(json.dumps(selected_release_recordings, sort_keys=True, indent=4))

# Get the selected recording information
selected_recording_id = selected_release_recordings['recording-list'][6]['id']
print("Selected recording id:")
print(selected_recording_id)


# Get the selected recording information
selected_recording_information = musicbrainzngs.get_recording_by_id(selected_recording_id)
print("Selected recording information:")
# print the results as formatted json
print(json.dumps(selected_recording_information, sort_keys=True, indent=4))

# Search works with the same title as the selected recording
selected_recording_title = selected_recording_information['recording']['title']
print("Selected recording title:")
print(selected_recording_title)
selected_recording_works = musicbrainzngs.search_works(selected_recording_title)
print("Selected recording works:")
# print the results as formatted json
print(json.dumps(selected_recording_works, sort_keys=True, indent=4))

# Filter the works to get the ones with the same title as the selected recording
selected_recording_works_same_title = []
for work in selected_recording_works['work-list']:
    if work['title'] == selected_recording_title:
        selected_recording_works_same_title.append(work)
# print("Selected recording works with the same title:")
# print the results as formatted json with a limit of 4 results
# print(json.dumps(selected_recording_works_same_title, sort_keys=True, indent=4, ensure_ascii=False))

# Get a formated JSON with the selected recording works with the same title adding artist id a name
selected_recording_works_same_title_with_artist = []
for work in selected_recording_works_same_title:
    selected_recording_works_same_title_with_artist.append({'id': work['id'], 'title': work['title']})
print("Selected recording works with the same title:")
# print the results as formatted json
print(json.dumps(selected_recording_works_same_title_with_artist, sort_keys=True, indent=4, ensure_ascii=False))

# Search and add the artist for each id in selected_recording_works_same_title_with_artist and add it to the list
for work in selected_recording_works_same_title_with_artist:
    # work_information = musicbrainzngs.get_work_by_id(work['id'])
    # Search the artists for the work id
    work_artists = musicbrainzngs.browse_artists(work= work['id'])
    # Add the first artist id to the work
    work['artist-id'] = work_artists['artist-list']
    # Add the first artist name to the work
    work['artist-name'] = work_artists['artist-list']

    # Add the artist to the work
    # work['artist'] = work_information
# print("Selected recording works with the same title:")
# print the results as formatted json
print(json.dumps(selected_recording_works_same_title_with_artist, sort_keys=True, indent=4, ensure_ascii=False))




# Stop here for now
exit()

# Get the selected recording relationships
selected_recording_relationships = musicbrainzngs.get_recording_by_id(selected_recording_id, includes=["artist-rels"])
print("Selected recording relationships:")
# print the results as formatted json
print(json.dumps(selected_recording_relationships, sort_keys=True, indent=4))









