# Bruno Collection Notes

This collection contains:

- App examples: endpoints used by the project (`/artist`, `/artist/{id}/performances`, `/performance`, `/search`).
- Exploratory requests: additional probes for `/work`, `/release`, `/label`, and search variants.
- Artist connections: recursive traversal workflow for pairwise artist connection exploration.

## Environments

Use one of these Bruno environments:

- `environments/local-proxy.bru` for the app proxy (`http://localhost:5173/api/secondhandsongs`)
- `environments/upstream.bru` for direct API (`https://api.secondhandsongs.com`)

## Suggested exploration order

1. `01-app-examples/*`
2. `02-exploratory/01-work-by-id.bru`
3. `02-exploratory/02-work-performances.bru`
4. `02-exploratory/03-release-by-id.bru`
5. `02-exploratory/04-label-by-id.bru`
6. `02-exploratory/05-search-by-title.bru`
7. `02-exploratory/06-artist-works.bru`
8. `03-artist-connections/*`
9. `03-artist-connections/CONNECTION_PLAYBOOK.md`

If a request returns errors due to rate limits, retry with the local proxy environment while your app dev server is running.
