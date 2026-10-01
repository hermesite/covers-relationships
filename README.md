# Secondhand Covers

Secondhand Covers explores relationships between recorded performances: which artists covered which songs, which recordings are originals, and how those links connect artists. The web app presents cover and original relationships as interactive graphs, using data from the SecondHandSongs API and precomputed datasets.

## Project Structure

```text
.
|-- api-collection/   Bruno requests for app endpoints and API exploration
|-- data/             Data generators, caches, saved responses, and research datasets
|-- frontend/
|   |-- data/         Static app assets and precomputed graph JSON
|   `-- src/          React application, components, and styles
`-- LICENSE
```

The app's local API proxy is implemented in `frontend/shs-api-plugin.js`. It forwards supported GET requests to SecondHandSongs and can cache responses for development and data generation. The Bruno collection includes both app examples and exploratory requests; see [api-collection/README.md](api-collection/README.md).

## Technologies

- JavaScript with React 17 and Vite
- Cytoscape.js with the fCoSE layout, plus D3, for graph visualization
- Bootstrap and Sass for interface styling
- Axios for HTTP requests
- Python 3 for generating offline graph datasets
- Bruno for organizing and running API requests

## Run Locally

From the `frontend/` directory:

```sh
npm install
npm start
```

The development server runs at <http://localhost:5173>. See [frontend/README.md](frontend/README.md) for app and proxy details, and [data/README.md](data/README.md) for graph generation, caches, and generated assets.