import requests
import json

# Connect to the musicbrainz API and get the artist data
artist = 'The Who'
url = 'http://musicbrainz.org/ws/2/artist/?query=artist:' + artist + '&fmt=json'
r = requests.get(url)

# print the results fromated as json
print(json.dumps(r.json(), indent=4, sort_keys=True))
