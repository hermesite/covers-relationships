
import requests
import json

import os
from requests.exceptions import HTTPError

# artistAId = "14076" # The Cramps
artistAId = "194" # David Bowie
# artistAId = "535" # The Who

path = artistAId
# Check whether the specified path exists or not
isExist = os.path.exists(path)
if not isExist:

   # Create a new directory because it does not exist
   os.makedirs(path)
   print("The new directory is created!")

try:
    # A entry artist
    artistA = requests.get('https://secondhandsongs.com/artist/' + artistAId, headers={"Accept":"application/json"})
    artistA.raise_for_status()
    artistA = artistA.json()
    # print("Artist A: main info")
    # print(json.dumps(artistA, sort_keys=True, indent=4))
    with open(artistAId + '/info.json', 'w', encoding='utf-8') as f:
        json.dump(artistA, f, ensure_ascii=False, indent=4)
    artistAPerformances = requests.get('https://secondhandsongs.com/artist/' + artistAId + '/performances', headers={"Accept":"application/json"})
    artistAPerformances = artistAPerformances.json()
    # print("Artist A: performances")
    # print(json.dumps(artistAPerformances, sort_keys=True, indent=4))

    # Split performaces in original and cover
    artistAPerformancesOriginal = []
    artistAPerformancesCover = []
    for performance in artistAPerformances:
        if performance['isOriginal'] == True:
            artistAPerformancesOriginal.append(performance)
        else:
            artistAPerformancesCover.append(performance)
    # print("Artist A: performances original")
    # print(json.dumps(artistAPerformancesOriginal, sort_keys=True, indent=4))
    # print("Artist A: performances cover")
    # print(json.dumps(artistAPerformancesCover, sort_keys=True, indent=4))

    completePlaylist = []
    # make a new request for each performance
    # dive into chunks of 8
    for performance in artistAPerformancesOriginal[0:5]:

    # for performance in artistAPerformancesOriginal:
        performanceId = performance['uri']
        # Get the end substring of the uri
        performanceId = performanceId[performanceId.rfind('/')+1:]

        performance = requests.get(performance['uri'], headers={"Accept":"application/json"})
        performance.raise_for_status()
        performance = performance.json()

        print("Calling original: " + performanceId + " - " + performance['title'])

        # Iterate on each covers item
        for cover in performance['covers']:
            # Create a new array of objects with filtered data
            performanceItem = {
                'originalTitle': performance['title'],
                'originalUri': performance['uri'],
                # save the end of the uri string as id
                'originalId': performance['uri'][performance['uri'].rfind('/')+1:],
                'originalPerfomerName': performance['performer']['name'],
                'originalPerfomerUri': performance['performer']['uri'],
                'originalPerfomerId': performance['performer']['uri'][performance['performer']['uri'].rfind('/')+1:],
                'coverTitle': cover['title'],
                'coverUri': cover['uri'],
                'coverId': cover['uri'][cover['uri'].rfind('/')+1:],
                'coverPerfomerName': cover['performer']['name'],
                'coverPerfomerUri': cover['performer']['uri'],
                'coverPerfomerId': cover['performer']['uri'][cover['performer']['uri'].rfind('/')+1:],
                'isOriginal': performance['isOriginal'],
            }
        
        completePlaylist.append(performanceItem)

    for performance in artistAPerformancesCover:
        performanceId = performance['uri']
        # Get the end substring of the uri
        performanceId = performanceId[performanceId.rfind('/')+1:]
        performance = requests.get(performance['uri'], headers={"Accept":"application/json"})
        performance.raise_for_status()
        performance = performance.json()

        print("Calling cover: " + performanceId + " - " + performance['title'])

        # Stop if originals is empty
        if len(performance['originals']) == 0:
            continue


        performanceItem = {
            'originalTitle': performance['originals'][0]['original']['title'],
            'originalUri': performance['originals'][0]['original']['uri'],
            # save the end of the uri string as id
            'originalId': performance['originals'][0]['uri'][performance['originals'][0]['original']['uri'].rfind('/')+1:],
            'originalPerfomerName': performance['originals'][0]['original']['performer']['name'],
            'originalPerfomerUri': performance['originals'][0]['original']['performer']['uri'],
            'originalPerfomerId': performance['originals'][0]['original']['performer']['uri'][performance['originals'][0]['original']['performer']['uri'].rfind('/')+1:],
            'coverTitle': performance['title'],
            'coverUri': performance['uri'],
            'coverId': performance['uri'][performance['uri'].rfind('/')+1:],
            'coverPerfomerName': performance['performer']['name'],
            'coverPerfomerUri': performance['performer']['uri'],
            'coverPerfomerId': performance['performer']['uri'][performance['performer']['uri'].rfind('/')+1:],
            'isOriginal': performance['isOriginal'],
        }
        completePlaylist.append(performanceItem)




    # Print the json
    print("Complete playlist")
    print(json.dumps(completePlaylist, sort_keys=True, indent=4))

    with open(artistAId + '/results.json', 'w', encoding='utf-8') as f:
        json.dump(completePlaylist, f, ensure_ascii=False, indent=4)

except HTTPError as http_err:
    print(f'HTTP error occurred: {http_err}')
except Exception as err:
    print(f'Other error occurred: {err}')

