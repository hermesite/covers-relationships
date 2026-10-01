import discogs_client
import os

token = os.environ.get('DISCOGS_TOKEN')
if not token:
	raise SystemExit('Missing DISCOGS_TOKEN environment variable')

d = discogs_client.Client('ExampleApplication/0.1', user_token=token)

release = d.search('Substitute', type='release')

print(release.pages)

# get the first page of results
results = release.page(1)
print(results)

# get the first result
release1 = results[0]
print(release1)


# get the artists from the release
# artists = release[0].artists
# print(artists)


