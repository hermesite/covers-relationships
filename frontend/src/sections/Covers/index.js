import Cytoscape from 'cytoscape';
import React, { Component } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CytoscapeComponent from 'react-cytoscapejs';
import fcose from 'cytoscape-fcose';
import { FaDownload, FaMusic, FaUndo } from 'react-icons/fa';

import { ARTIST_OPTIONS } from '../../constants/artistOptions';
import { getArtistIdFromUrl, setArtistIdInUrl } from '../artistUrl';

Cytoscape.use(fcose);

const UNGROUPED_ALBUM_ID = 'no-album';
const LAYOUT_OPTIONS = [
  { value: 'fcose', label: 'fCoSE' },
  { value: 'cose', label: 'CoSE' },
  { value: 'breadthfirst', label: 'Hierarchy' },
  { value: 'concentric', label: 'Concentric' },
  { value: 'grid', label: 'Grid' },
];

const ALBUM_COLORS = [
  '#236978', '#b8683e', '#58713d', '#a14855', '#426a8c',
  '#997326', '#536b8e', '#8c5f3f', '#467468', '#765b78',
];
const songIcons = new Map();
const songIcon = (color) => {
  if (!songIcons.has(color)) {
    songIcons.set(color, `data:image/svg+xml,${encodeURIComponent(
      renderToStaticMarkup(<FaMusic color={color} size={28} />)
    )}`);
  }
  return songIcons.get(color);
};
const ungroupedSongIcon = songIcon('#b8683e');

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

const addCamelCaseSpaces = (value) => value
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
const formatSongTitle = (title) => addCamelCaseSpaces(title);
const formatArtistName = (name) => addCamelCaseSpaces(name.replace(/\s*\[[^\]]*\]/g, '').trim());

const getReleaseYear = (release) => Number(release?.year) || Infinity;

const getOrderedReleases = (songs) => [...new Map(songs.flatMap((song) => song.coverReleases || [])
  .filter((release) => release?.uri && release.title)
  .map((release) => [release.uri, release])).values()]
  .sort((first, second) => getReleaseYear(first) - getReleaseYear(second)
    || first.title.localeCompare(second.title));

const getAlbumColors = (songs) => new Map(getOrderedReleases(songs)
  .map((release, index) => [release.uri, ALBUM_COLORS[index % ALBUM_COLORS.length]]));

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
      selectedAlbumIds: [],
      layoutName: 'fcose',
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
  }

  componentWillUnmount() {
    this.isMountedFlag = false;
    window.removeEventListener('resize', this.onResize);
  }

  fitGraph = (cy) => {
    const focus = cy.nodes('[nodeType = "album"], [nodeType = "selectedArtist"]');
    cy.fit(focus.length > 0 ? focus : cy.nodes(), 40);
    if (cy.width() >= 800 && cy.zoom() < 0.6) {
      cy.zoom(0.6);
      cy.center(cy.nodes('[nodeType = "selectedArtist"]'));
    }
  };

  onResize = () => {
    const width = this.canvasCoversContainer.current?.offsetWidth || window.innerWidth;
    this.setState({
      canvasContainerWidth: width,
      canvasContainerHeight: this.canvasCoversContainer.current?.offsetHeight || Math.max(400, window.innerHeight - 60),
    }, () => {
      if (!this.cy || this.cy.destroyed()) return;
      this.cy.resize();
      this.fitGraph(this.cy);
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

  onAlbumToggle = (albumId) => {
    this.setState(({ selectedAlbumIds }) => ({
      selectedAlbumIds: selectedAlbumIds.includes(albumId)
        ? selectedAlbumIds.filter((id) => id !== albumId)
        : [...selectedAlbumIds, albumId],
    }));
  };

  downloadGraph = () => {
    if (!this.cy || this.cy.destroyed()) return;
    try {
      const link = document.createElement('a');
      link.href = this.cy.png({ bg: '#ffffff', full: true, maxWidth: 2400 });
      link.download = `covers-${this.state.selectedArtistId}-${this.state.layoutName}.png`;
      link.click();
    } catch (error) {
      this.setState({ error: error.message || 'Unable to export the graph image.' });
    }
  };

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
      const payloadSongs = payloadData
        .filter((item) => item?.data?.id && !item.data.source && !item.data.target && !targetIds.has(item.data.id))
        .map((item) => item.data);
      const albumColors = getAlbumColors(payloadSongs);

      const typedNetworkData = payloadData.map((item) => {
        const data = item?.data || {};
        if (data.source || data.target) {
          return { ...item, data: { ...data, id: data.id || `edge:${data.source}->${data.target}` } };
        }
        const nodeType = targetIds.has(data.id) ? 'artist' : sourceIds.has(data.id) ? 'song' : 'song';
        const release = nodeType === 'song'
          ? [...(data.coverReleases || [])].filter((item) => item?.uri && item.title)
            .sort((first, second) => getReleaseYear(first) - getReleaseYear(second)
              || first.title.localeCompare(second.title))[0]
          : null;
        const albumColor = release ? albumColors.get(release.uri) : null;
        return {
          ...item,
          data: {
            ...data,
            nodeType,
            ...(nodeType === 'artist' && { label: formatArtistName(data.label || '') }),
            ...(nodeType === 'song' && { label: formatSongTitle(data.label || '') }),
            ...(nodeType === 'artist' && { imageUrl: isValidImageUrl(data.imageUrl) ? data.imageUrl : null }),
            ...(nodeType === 'song' && {
              albumColor: albumColor || '#b8683e',
              songIconUrl: songIcon(albumColor || '#b8683e'),
            }),
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
        if (validReleases.length === 0) {
          ungroupedSongs.push(data.id);
          data.ungrouped = true;
        }
        validReleases.forEach((release) => {
          const albumId = `album:${release.uri}`;
          if (!albumNodes.has(albumId)) {
            albumNodes.set(albumId, {
              data: {
                id: albumId,
                label: formatSongTitle(release.title),
                nodeType: 'album',
                year: release.year || null,
                albumColor: albumColors.get(release.uri) || '#b8683e',
                imageUrl: isValidImageUrl(release.imageUrl) ? release.imageUrl : null,
              },
            });
          }
          albumEdges.push({ data: { id: `edge:${albumId}->${data.id}`, source: albumId, target: data.id, relation: 'album-track' } });
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
          data: { id: `edge:${selectedNodeId}->${target}`, source: selectedNodeId, target, relation: 'cover' },
        })),
      ] : typedNetworkData;

      const containerWidth = this.canvasCoversContainer.current?.offsetWidth || window.innerWidth;
      const containerHeight = this.canvasCoversContainer.current?.offsetHeight || Math.max(400, window.innerHeight - 60);

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
      selectedAlbumIds,
      layoutName,
      coversCount,
      networkData,
      canvasContainerWidth,
      canvasContainerHeight,
      partialData,
    } = this.state;
    const hasNetworkData = Array.isArray(networkData) && networkData.length > 0;
    const albums = networkData
      .filter((item) => item.data?.nodeType === 'album')
      .sort((first, second) => (first.data.year || Infinity) - (second.data.year || Infinity)
        || first.data.label.localeCompare(second.data.label));
    const albumSongCounts = new Map(albums.map((item) => [item.data.id, 0]));
    networkData.filter((item) => item.data?.relation === 'album-track').forEach((item) => {
      albumSongCounts.set(item.data.source, (albumSongCounts.get(item.data.source) || 0) + 1);
    });
    const songs = networkData.filter((item) => item.data?.nodeType === 'song');
    const ungroupedCount = songs.filter((item) => item.data.ungrouped).length;
    const visibleSongIds = new Set(songs.filter((item) => selectedAlbumIds.length === 0
      || (item.data.ungrouped && selectedAlbumIds.includes(UNGROUPED_ALBUM_ID))
      || (item.data.coverReleases || []).some((release) => selectedAlbumIds.includes(`album:${release.uri}`)))
      .map((item) => item.data.id));
    const visibleAlbumIds = new Set(albums.filter((item) => selectedAlbumIds.length === 0
      || selectedAlbumIds.includes(item.data.id)).map((item) => item.data.id));
    const visibleArtistIds = new Set(networkData.filter((item) => visibleSongIds.has(item.data?.source)
      && item.data?.target).map((item) => item.data.target));
    const visibleNodeIds = new Set(networkData.filter((item) => item.data?.nodeType === 'selectedArtist'
      || visibleSongIds.has(item.data?.id) || visibleAlbumIds.has(item.data?.id)
      || visibleArtistIds.has(item.data?.id)).map((item) => item.data.id));
    const visibleNetworkData = networkData.filter((item) => item.data?.source && item.data?.target
      ? visibleNodeIds.has(item.data.source) && visibleNodeIds.has(item.data.target)
      : visibleNodeIds.has(item.data?.id));
    const visibleAlbums = albums.filter((item) => visibleAlbumIds.has(item.data.id));
    const columns = Math.ceil(Math.sqrt(visibleAlbums.length));
    const rows = Math.ceil(visibleAlbums.length / columns);

    const layout = {
      name: layoutName,
      animate: false,
      fit: false,
      nodeDimensionsIncludeLabels: true,
      ...(layoutName === 'fcose' ? {
        quality: 'proof',
        fixedNodeConstraint: [
        ...visibleNetworkData.filter((item) => item.data?.nodeType === 'selectedArtist').map((item) => ({
          nodeId: item.data.id,
          position: { x: 0, y: 0 },
        })),
        ...visibleAlbums.map((item, index) => ({
          nodeId: item.data.id,
          position: {
            x: 450 + (index % columns) * 280,
            y: (Math.floor(index / columns) - (rows - 1) / 2) * 300,
          },
        })),
        ],
        relativePlacementConstraint: visibleNetworkData
        .filter((item) => item.data?.ungrouped)
        .map((item) => ({ left: item.data.id, right: `selected-artist-${this.state.selectedArtistId}`, gap: 420 })),
        nodeRepulsion: (node) => node.data('nodeType') === 'selectedArtist' ? 120000
        : node.data('nodeType') === 'album' ? 25000 : 12000,
        idealEdgeLength: (edge) => edge.data('relation') === 'cover' ? 220
        : edge.data('relation') === 'album-track' ? 160 : 70,
        edgeElasticity: (edge) => edge.data('relation') === 'album-track' ? 0.8 : 0.35,
      } : {}),
      ...(layoutName === 'breadthfirst' ? {
        directed: true,
        direction: 'rightward',
        roots: visibleNetworkData.filter((item) => item.data?.nodeType === 'selectedArtist').map((item) => item.data.id),
        spacingFactor: 1.25,
      } : {}),
      ...(layoutName === 'concentric' ? {
        concentric: (node) => ({ selectedArtist: 3, album: 2, song: 1, artist: 0 })[node.data('nodeType')],
        levelWidth: () => 1,
        minNodeSpacing: 24,
      } : {}),
      ...(layoutName === 'grid' ? { avoidOverlap: true, spacingFactor: 1.2 } : {}),
    };

    return (
      <section className='section section-covers'>
        <div className='covers-layout'>
          <aside className='covers-side-panel' aria-label='Album filters'>
            <h1>{artist?.commonName || ARTIST_OPTIONS.find((option) => String(option.id) === this.state.selectedArtistId)?.name}</h1>
            {!loading && !error && <p className='covers-side-count'>{visibleSongIds.size}{selectedAlbumIds.length > 0 ? ` of ${coversCount}` : ''} covers{partialData ? ' (partial)' : ''}</p>}
            <div className='covers-filter-heading'>
              <h2 className='covers-side-heading'>Albums</h2>
              <button type='button' className='covers-filter-reset' onClick={() => this.setState({ selectedAlbumIds: [] })} disabled={selectedAlbumIds.length === 0}>
                <FaUndo aria-hidden='true' /> Show all
              </button>
            </div>
            <div className='covers-graph-controls'>
              <label htmlFor='covers-layout-select'>Layout</label>
              <select id='covers-layout-select' value={layoutName} onChange={(event) => this.setState({ layoutName: event.target.value })}>
                {LAYOUT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <button type='button' className='covers-export-button' onClick={this.downloadGraph} disabled={loading || error || !hasNetworkData}>
                <FaDownload aria-hidden='true' /> Download PNG
              </button>
            </div>
            {!loading && !error && (
              <div className='covers-album-list'>
                {albums.map(({ data }) => (
                  <label className={`covers-album-option${selectedAlbumIds.includes(data.id) ? ' is-selected' : ''}`} key={data.id}>
                    <input type='checkbox' checked={selectedAlbumIds.includes(data.id)} onChange={() => this.onAlbumToggle(data.id)} />
                    {data.imageUrl ? <img src={data.imageUrl} alt='' /> : <span className='covers-album-placeholder' aria-hidden='true' />}
                    <span className='covers-album-title'>{data.label}</span>
                    <span className='covers-album-count'>{albumSongCounts.get(data.id)}</span>
                  </label>
                ))}
                {ungroupedCount > 0 && (
                  <label className={`covers-album-option${selectedAlbumIds.includes(UNGROUPED_ALBUM_ID) ? ' is-selected' : ''}`}>
                    <input type='checkbox' checked={selectedAlbumIds.includes(UNGROUPED_ALBUM_ID)} onChange={() => this.onAlbumToggle(UNGROUPED_ALBUM_ID)} />
                    <span className='covers-album-placeholder' aria-hidden='true' />
                    <span className='covers-album-title'>No album</span>
                    <span className='covers-album-count'>{ungroupedCount}</span>
                  </label>
                )}
              </div>
            )}
          </aside>
          <div id='canvasContainer' ref={this.canvasCoversContainer} className='canvas-container'>
            {!loading && !error && hasNetworkData && (
              <CytoscapeComponent
                key={`${layoutName}:${selectedAlbumIds.slice().sort().join('|') || 'all'}`}
                elements={visibleNetworkData}
                cy={(cy) => {
                  if (this.cy === cy) return;
                  this.cy = cy;
                  this.initListeners();
                  cy.layout(layout).run();
                  this.fitGraph(cy);
                  cy.nodes('[nodeType = "artist"]').forEach((node) => {
                    const imageUrl = node.data('imageUrl');
                    if (!imageUrl) return;
                    const image = new Image();
                    image.onload = () => {
                      if (cy.destroyed()) return;
                      node.style('background-image-opacity', 1);
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
                      color: '#252b28',
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
                      shape: 'ellipse',
                      width: 120,
                      height: 120,
                      'background-opacity': 0,
                      'background-image': (ele) => ele.data('imageUrl') || 'none',
                      'background-fit': 'cover',
                      'background-image-opacity': 0,
                      color: '#252b28',
                      'font-size': 14,
                      'font-weight': 700,
                      'text-wrap': 'wrap',
                      'text-max-width': 110,
                      'text-halign': 'center',
                      'text-valign': 'bottom',
                      'text-margin-y': 16,
                    },
                  },
                  {
                    selector: 'node[nodeType = "artist"][!imageUrl]',
                    style: {
                      width: 110,
                      height: 110,
                      'background-color': '#e3e9e6',
                      'background-opacity': 1,
                      'border-width': 1,
                      'border-color': '#474d49',
                      'font-size': 12,
                      'text-valign': 'center',
                      'text-margin-y': 0,
                      'text-overflow-wrap': 'whitespace',
                      'text-max-width': 94,
                    },
                  },
                  {
                    selector: 'node[nodeType = "song"]',
                    style: {
                        shape: 'rectangle',
                      color: '#252b28',
                      'font-family': 'Kreon',
                      'font-size': 22,
                      'font-weight': 700,
                      width: 40,
                      height: 40,
                      'background-opacity': 0,
                      'background-image': (ele) => ele.data('songIconUrl') || ungroupedSongIcon,
                      'background-fit': 'contain',
                      'border-width': 0,
                      'text-halign': 'center',
                      'text-valign': 'bottom',
                      'text-margin-y': 12,
                      'text-wrap': 'wrap',
                      'text-overflow-wrap': 'whitespace',
                      'text-max-width': 140,
                    },
                  },
                  {
                    selector: 'node[nodeType = "song"][ungrouped]',
                    style: {
                      'background-color': '#b8683e',
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
                      label: (ele) => (ele.data('imageUrl') ? '' : ele.data('label')),
                      color: '#252b28',
                      'font-size': 16,
                      'font-weight': 700,
                      'text-halign': 'center',
                      'text-valign': 'bottom',
                      'text-margin-y': 18,
                      'text-wrap': 'wrap',
                      'text-overflow-wrap': 'whitespace',
                      'text-max-width': 145,
                      'border-width': 4,
                      'border-color': (ele) => ele.data('albumColor') || '#467468',
                    },
                  },
                  {
                    selector: 'node[nodeType = "album"][!imageUrl]',
                    style: {
                      width: 106.667,
                      height: 106.667,
                      'background-color': (ele) => ele.data('albumColor') || '#d9af5a',
                      'background-opacity': 1,
                      color: '#ffffff',
                      'text-valign': 'center',
                      'text-margin-y': 0,
                      'text-max-width': 96,
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
                      'line-color': '#474d49',
                      width: 1,
                      color: '#252b28',
                      opacity: 0.65,
                      'curve-style': 'straight',
                    },
                  },
                  {
                    selector: 'edge[relation = "cover"]',
                    style: {
                      'line-color': '#353b37',
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
