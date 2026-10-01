import Cytoscape from 'cytoscape';
import React, { Component } from 'react';
import CytoscapeComponent from 'react-cytoscapejs';
import fcose from 'cytoscape-fcose';

import { ARTIST_OPTIONS } from '../../constants/artistOptions';
import { getArtistIdFromUrl, setArtistIdInUrl } from '../artistUrl';
import { BandMemberList } from '../BandDetail';

Cytoscape.use(fcose);

const isValidImageUrl = (url) => {
  if (typeof url !== 'string') return false;
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
};

const uniqueImageUrls = (urls) => {
  const seen = new Set();
  return urls.filter((url) => {
    if (typeof url !== 'string' || !url) return false;
    try {
      const parsed = new URL(url);
      const key = `${parsed.origin}${parsed.pathname}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    } catch {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    }
  });
};

class Covers extends Component {
  constructor() {
    super();
    this.state = {
      selectedArtistId: getArtistIdFromUrl(ARTIST_OPTIONS),
      loading: true,
      error: null,
      coversCount: 0,
      networkData: [],
      artist: null,
      bandRelations: [],
      bandLoading: true,
      bandError: null,
      canvasContainerWidth: window.innerWidth,
      canvasContainerHeight: Math.max(window.innerHeight * 0.6, 400),
      partialData: false,
    };
    this.canvasCoversContainer = React.createRef();
    this.isMountedFlag = false;
  }

  componentDidMount() {
    this.isMountedFlag = true;
    window.addEventListener('resize', this.onResize);
    setArtistIdInUrl(this.state.selectedArtistId);
    this.loadGraphForArtist(Number(this.state.selectedArtistId));
    this.loadBandRelations(Number(this.state.selectedArtistId));
  }

  componentWillUnmount() {
    this.isMountedFlag = false;
    window.removeEventListener('resize', this.onResize);
  }

  fitArtists = (cy) => {
    const artists = cy.nodes('[nodeType = "artist"], [nodeType = "selectedArtist"]');
    cy.fit(artists, 40);
    if (cy.width() >= 800 && cy.zoom() < 0.8) {
      cy.zoom(0.8);
      cy.center(cy.nodes('[nodeType = "selectedArtist"]'));
    }
  };

  onResize = () => {
    this.setState({
      canvasContainerWidth: this.canvasCoversContainer.current?.offsetWidth || window.innerWidth,
      canvasContainerHeight: this.canvasCoversContainer.current?.offsetHeight || window.innerHeight,
    }, () => {
      if (!this.cy || this.cy.destroyed()) return;
      this.cy.resize();
      this.fitArtists(this.cy);
    });
  };

  initListeners() {
    this.cy.on('mouseover', 'node', (evt) => {
      const node = evt.target;
      const related = node.connectedEdges().union(node.connectedNodes());
      this.cy.elements().difference(related).not(node).addClass('semitransp');
      node.addClass('highlight');
      related.addClass('highlight');
    });

    this.cy.on('mouseout', 'node', (evt) => {
      this.cy.elements().removeClass('semitransp');
      this.cy.elements().removeClass('highlight');
    });
  }

  async loadBandRelations(artistId) {
    try {
      const response = await fetch(`/band-detail/${artistId}.json`);
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('Band details are not available for this artist.');
      }
      const payload = await response.json();
      if (!this.isMountedFlag) return;
      this.setState({
        bandRelations: Array.isArray(payload.relations) ? payload.relations : [],
        bandLoading: false,
      });
    } catch (error) {
      if (!this.isMountedFlag) return;
      this.setState({ bandLoading: false, bandError: error.message });
    }
  }

  async loadGraphForArtist(artistId) {
    try {
      const response = await fetch(`/graphs/covers/${artistId}.json`);
      if (!response.ok) {
        throw new Error('Generated data file not found. Run the Python data generator first.');
      }

      const payload = await response.json();
      const fallbackArtistImage =
        payload.artistPictureResolved || payload.artistPicture || payload.artist?.picture || null;
      const artistImageUrls = uniqueImageUrls([
        ...(Array.isArray(payload.artistPictures) ? payload.artistPictures : []),
        fallbackArtistImage,
      ]);

      const payloadData = Array.isArray(payload.networkData) ? payload.networkData : [];
      const sourceIds = new Set(
        payloadData
          .filter((item) => item?.data?.source)
          .map((item) => item.data.source)
      );
      const targetIds = new Set(
        payloadData
          .filter((item) => item?.data?.target)
          .map((item) => item.data.target)
      );

      const typedNetworkData = payloadData.map((item) => {
        const data = item?.data || {};
        if (data.source || data.target) return item;
        const nodeType = targetIds.has(data.id) ? 'artist' : sourceIds.has(data.id) ? 'song' : 'song';
        return {
          ...item,
          data: {
            ...data,
            nodeType,
            ...(nodeType === 'artist' && { imageUrl: isValidImageUrl(data.imageUrl) ? data.imageUrl : null }),
          },
        };
      });
      const selectedNodeId = `selected-artist-${artistId}`;
      const albumNodes = new Map();
      const albumEdges = [];
      const ungroupedSongs = [];
      typedNetworkData.filter((item) => item.data.nodeType === 'song').forEach(({ data }) => {
        const releases = Array.isArray(data.coverReleases) ? data.coverReleases : [];
        const validReleases = releases.filter((release) => release?.uri && release.title);
        if (validReleases.length === 0) ungroupedSongs.push(data.id);
        validReleases.forEach((release) => {
          const albumId = `album:${release.uri}`;
          if (!albumNodes.has(albumId)) {
            albumNodes.set(albumId, {
              data: {
                id: albumId,
                label: release.title,
                nodeType: 'album',
                imageUrl: isValidImageUrl(release.imageUrl) ? release.imageUrl : null,
              },
            });
          }
          albumEdges.push({ data: { source: albumId, target: data.id, relation: 'album-track' } });
        });
      });
      const graphData = payload.artist && sourceIds.size > 0 ? [
        ...typedNetworkData,
        {
          data: {
            id: selectedNodeId,
            label: payload.artist.commonName,
            nodeType: 'selectedArtist',
            imageUrl: artistImageUrls[0] || null,
          },
        },
        ...albumNodes.values(),
        ...albumEdges,
        ...[...albumNodes.keys(), ...ungroupedSongs].map((target) => ({
          data: { source: selectedNodeId, target, relation: 'cover' },
        })),
      ] : typedNetworkData;

      const containerWidth = this.canvasCoversContainer.current?.offsetWidth || window.innerWidth;
      const containerHeight =
        this.canvasCoversContainer.current?.offsetHeight || Math.max(window.innerHeight * 0.6, 400);

      if (!this.isMountedFlag) return;
      this.setState({
        loading: false,
        error: payload.error || null,
        artist: payload.artist || null,
        coversCount: Number(payload.coversCount || 0),
        networkData: graphData,
        canvasContainerWidth: containerWidth,
        canvasContainerHeight: containerHeight,
        partialData: Boolean(payload.partialData),
      });
    } catch (error) {
      if (!this.isMountedFlag) return;
      this.setState({
        loading: false,
        error: error?.message || 'Failed to load cover data.',
      });
    }
  }

  render() {
    const {
      loading,
      error,
      artist,
      bandRelations,
      bandLoading,
      bandError,
      coversCount,
      networkData,
      canvasContainerWidth,
      canvasContainerHeight,
      partialData,
    } = this.state;
    const hasNetworkData = Array.isArray(networkData) && networkData.length > 0;

    const layout = {
      name: 'fcose',
      animate: false,
      fit: false,
      quality: 'proof',
      nodeDimensionsIncludeLabels: true,
      nodeRepulsion: (node) => node.data('nodeType') === 'selectedArtist' ? 120000 : 4500,
      idealEdgeLength: (edge) => edge.data('relation') === 'cover' ? 220 : 50,
    };

    return (
      <section className='section section-covers'>
        <div className='covers-layout'>
          <aside className='covers-side-panel' aria-label='Band members'>
            <h1>{artist?.commonName || ARTIST_OPTIONS.find((option) => String(option.id) === this.state.selectedArtistId)?.name}</h1>
            {!loading && !error && <p className='covers-side-count'>{coversCount} covers{partialData ? ' (partial)' : ''}</p>}
            <h2 className='covers-side-heading'>People in the band</h2>
            {bandLoading && <p>Loading band members...</p>}
            {bandError && <p role='alert'>{bandError}</p>}
            {!bandLoading && !bandError && bandRelations.length === 0 && <p>No members are recorded for this band.</p>}
            {!bandLoading && !bandError && bandRelations.length > 0 && <BandMemberList relations={bandRelations} />}
          </aside>
          <div id='canvasContainer' ref={this.canvasCoversContainer} className='canvas-container'>
          {!loading && !error && hasNetworkData && (
            <CytoscapeComponent
              elements={networkData}
              layout={layout}
              cy={(cy) => {
                this.cy = cy;
                this.initListeners();
                cy.layout(layout).run();
                this.fitArtists(cy);
                cy.nodes('[nodeType = "artist"]').forEach((node) => {
                  const imageUrl = node.data('imageUrl');
                  if (!imageUrl) return;
                  const image = new Image();
                  image.onload = () => {
                    if (cy.destroyed()) return;
                    const scale = Math.min(node.width() / image.naturalWidth, node.height() * 2 / 3 / image.naturalHeight);
                    node.style({
                      'background-width': image.naturalWidth * scale,
                      'background-height': image.naturalHeight * scale,
                      'background-image-opacity': 1,
                    });
                  };
                  image.onerror = () => {
                    if (!cy.destroyed()) node.data('imageUrl', null);
                  };
                  image.src = imageUrl;
                });
              }}
              style={{
                width: canvasContainerWidth,
                height: canvasContainerHeight,
              }}
              stylesheet={[
                {
                  selector: 'node',
                  style: {
                    color: '#1f1f1f',
                    'font-size': 12,
                    width: 14,
                    height: 14,
                    'background-color': '#1f1f1f',
                    label: (ele) => (ele.isNode() ? ele.data('label') : null),
                    opacity: 1,
                    'font-family': 'Big Shoulders Display',
                    'text-valign': 'center',
                    'background-opacity': 0,
                    'text-wrap': 'wrap',
                    'text-max-width': 200,
                  },
                },
                {
                  selector: 'node[nodeType = "artist"]',
                  style: {
                    shape: 'rectangle',
                    width: 120,
                    height: 120,
                    'background-opacity': 0,
                    'background-image': (ele) => ele.data('imageUrl') || 'none',
                    'background-fit': 'none',
                    'background-width': '100%',
                    'background-height': '66.6667%',
                    'background-position-y': '0%',
                    'background-image-opacity': 0,
                    color: '#000000',
                    'font-size': 14,
                    'font-weight': 700,
                    'text-wrap': 'wrap',
                    'text-max-width': 110,
                    'text-halign': 'center',
                    'text-valign': 'bottom',
                    'text-margin-y': -28,
                  },
                },
                {
                  selector: 'node[nodeType = "artist"][!imageUrl]',
                  style: {
                    height: 60,
                    'text-valign': 'center',
                    'text-margin-y': 0,
                  },
                },
                {
                  selector: 'node[nodeType = "song"]',
                  style: {
                    shape: 'ellipse',
                    color: '#236978',
                    'font-family': 'Kreon',
                    'font-size': 22,
                    'font-weight': 700,
                    width: 8,
                    height: 8,
                    'background-color': '#236978',
                    'background-opacity': 1,
                    'border-width': 0,
                    'text-halign': 'center',
                    'text-valign': 'bottom',
                    'text-margin-y': 12,
                    'text-wrap': 'wrap',
                    'text-overflow-wrap': 'anywhere',
                    'text-max-width': 140,
                  },
                },
                {
                  selector: 'node[nodeType = "album"]',
                  style: {
                    shape: 'rectangle',
                    width: 160,
                    height: 160,
                    'background-color': '#e1ede8',
                    'background-image': (ele) => ele.data('imageUrl') || 'none',
                    'background-fit': 'cover',
                    'background-image-opacity': 1,
                    color: '#244c43',
                    'font-size': 16,
                    'font-weight': 700,
                    'text-halign': 'center',
                    'text-valign': 'bottom',
                    'text-margin-y': 18,
                    'text-wrap': 'wrap',
                    'text-overflow-wrap': 'anywhere',
                    'text-max-width': 145,
                    'border-width': 1,
                    'border-color': '#467468',
                  },
                },
                {
                  selector: 'node[nodeType = "album"][!imageUrl]',
                  style: {
                    'text-valign': 'center',
                    'text-margin-y': 0,
                  },
                },
                {
                  selector: 'node[nodeType = "selectedArtist"]',
                  style: {
                    shape: 'ellipse',
                    width: 240,
                    height: 240,
                    'background-opacity': 0,
                    'background-image': (ele) => ele.data('imageUrl') || 'none',
                    'background-fit': 'cover',
                    'background-image-opacity': 1,
                    'border-width': 4,
                    'border-color': '#762c27',
                    label: '',
                  },
                },
                {
                  selector: 'edge',
                  style: {
                    'line-color': (ele) => ele.data('color') || '#762c27',
                    width: 1,
                    color: (ele) => ele.data('color') || '#762c27',
                    opacity: (ele) => ele.data('opacity') ?? 0.4,
                    'curve-style': 'haystack',
                  },
                },
                {
                  selector: 'edge[relation = "cover"]',
                  style: {
                    'line-color': '#762c27',
                    width: 2,
                    opacity: 0.4,
                  },
                },
                {
                  selector: 'edge.highlight',
                  style: { opacity: '0.9' },
                },
                {
                  selector: 'edge.semitransp',
                  style: { opacity: '0.5' },
                },
              ]}
            />
          )}
          {loading && (
            <div className='container pt-4'>
              <p>Loading cover graph...</p>
            </div>
          )}
          {!loading && !error && !hasNetworkData && (
            <div className='container pt-4'>
              <p>No graph data available for this artist.</p>
            </div>
          )}
          {error && (
            <div className='container pt-4'>
              <p>Unable to render cover graph.</p>
              <p>
                <small>{error}</small>
              </p>
            </div>
          )}
          </div>
        </div>
      </section>
    );
  }
}

export default Covers;
