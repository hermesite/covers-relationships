import Cytoscape from 'cytoscape';
import React, { Component } from 'react';
import CytoscapeComponent from 'react-cytoscapejs';
import cola from 'cytoscape-cola';
import fcose from 'cytoscape-fcose';
import svg from 'cytoscape-svg';
import { FaDownload, FaSearch, FaTimes, FaUndo } from 'react-icons/fa';

import { ARTIST_OPTIONS } from '../../constants/artistOptions';
import { getArtistIdFromUrl, setArtistIdInUrl } from '../artistUrl';

Cytoscape.use(fcose);
Cytoscape.use(cola);
Cytoscape.use(svg);

const UNGROUPED_ALBUM_ID = 'no-album';
const SOURCE_MODES = [
  { value: 'both', label: 'Both' },
  { value: 'covers', label: 'Covers' },
  { value: 'originals', label: 'Originals' },
];
const LAYOUT_OPTIONS = [
  { value: 'cola', label: 'No overlap' },
  { value: 'fcose', label: 'fCoSE' },
  { value: 'cose', label: 'CoSE' },
  { value: 'breadthfirst', label: 'Hierarchy' },
  { value: 'concentric', label: 'Concentric' },
  { value: 'grid', label: 'Grid' },
];

const isValidImageUrl = (url) => {
  if (typeof url !== 'string') return false;
  if (/^\/images\/(releases|artists)\/\d+(?:\+\d+)*\.(jpg|png|webp|gif)$/.test(url)) return true;
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
const releasesForSong = (song) => song.graphReleases
  || (song.sourceType === 'originals' ? song.releases : song.coverReleases) || [];

const getReleaseYear = (release) => Number(release?.year) || Infinity;

const getOrderedReleases = (songs) => [...new Map(songs.flatMap(releasesForSong)
  .filter((release) => release?.uri && release.title)
  .map((release) => [release.uri, release])).values()]
  .sort((first, second) => getReleaseYear(first) - getReleaseYear(second)
    || first.title.localeCompare(second.title));

const getReleaseEdgeWidth = (edge) => {
  const songCount = Math.max(1, edge.target().connectedEdges('[relation = "album-track"]').length);
  return Math.min(6, 1 + Math.log2(songCount));
};

const getSongColor = (song) => song.sourceTypes?.length > 1 ? '#58713d'
  : song.sourceType === 'originals' ? '#b8683e' : '#236978';

class Covers extends Component {
  constructor() {
    super();
    this.state = {
      selectedArtistId: getArtistIdFromUrl(ARTIST_OPTIONS),
      loading: true,
      error: null,
      coversCount: 0,
      originalsCount: 0,
      networkData: [],
      artist: null,
      selectedAlbumIds: [],
      searchQuery: '',
      searchType: 'song',
      exportFormat: 'png',
      exportError: null,
      sourceMode: 'both',
      layoutName: 'cola',
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
    this.graphLayout?.stop();
    window.removeEventListener('resize', this.onResize);
  }

  fitGraph = (cy) => {
    cy.fit(cy.nodes(), 32);
  };

  runGraphLayout = (cy, layout) => {
    this.graphLayout?.stop();
    const central = cy.nodes('[nodeType = "selectedArtist"]').first();
    const covers = cy.nodes().filter((node) => node.data('nodeType') === 'song'
      ? node.data('sourceType') === 'covers'
      : node.data('artistRole') === 'original-performer'
        || (node.data('nodeType') === 'album' && node.data('sourceTypes')?.length === 1
          && node.data('sourceTypes').includes('covers')));
    const originals = cy.nodes().filter((node) => node.data('nodeType') === 'song'
      ? node.data('sourceType') === 'originals'
      : node.data('artistRole') === 'cover-performer'
        || (node.data('nodeType') === 'album' && node.data('sourceTypes')?.length === 1
          && node.data('sourceTypes').includes('originals')));
    const separateSources = central.length > 0 && covers.length > 0 && originals.length > 0;
    const mixedReleases = cy.nodes('[nodeType = "album"]').filter((node) => node.data('sourceTypes')?.length > 1);
    const seedClusters = separateSources || (central.length > 0 && mixedReleases.length > 0);
    const constraints = separateSources ? [
      ...covers.filter('[nodeType != "artist"]').map((node) => ({ left: node, right: central })),
      ...originals.filter('[nodeType != "artist"]').map((node) => ({ left: central, right: node })),
    ] : [];
    if (seedClusters) {
      cy.batch(() => {
        central.position({ x: 0, y: 0 });
        [covers, originals].forEach((group, side) => {
          const nodes = group.filter('[nodeType != "artist"]');
          const aspectRatio = Math.max(0.25, Math.min(1, cy.width() / (2 * cy.height())));
          const columns = Math.ceil(Math.sqrt(nodes.length * aspectRatio));
          const rows = Math.ceil(nodes.length / columns);
          nodes.forEach((node, index) => node.position({
            x: (side === 0 ? -1 : 1) * (400 + (index % columns) * 200),
            y: (Math.floor(index / columns) - (rows - 1) / 2) * 180,
          }));
        });
        const shared = cy.nodes().difference(covers).difference(originals).not(central);
        shared.forEach((node, index) => {
          const row = Math.floor(index / 2) - Math.ceil(shared.length / 4);
          node.position({ x: index % 2 === 0 ? -160 : 160, y: (row < 0 ? row : row + 1) * 320 });
        });
        cy.nodes('[nodeType = "artist"]').forEach((node) => {
          const songs = node.neighborhood('[nodeType = "song"]');
          if (songs.length === 0) return;
          const peers = songs.first().neighborhood('[nodeType = "artist"]').toArray();
          const index = peers.findIndex((peer) => peer.id() === node.id());
          const angle = -Math.PI / 2 + ((index % 6) + 1) * Math.PI / 7;
          const radius = 140 + Math.floor(index / 6) * 110;
          const side = node.data('artistRole') === 'original-performer' ? -1 : 1;
          node.position({
            x: songs.reduce((sum, song) => sum + song.position('x'), 0) / songs.length + side * Math.cos(angle) * radius,
            y: songs.reduce((sum, song) => sum + song.position('y'), 0) / songs.length + Math.sin(angle) * radius,
          });
        });
        cy.nodes('[nodeType = "album"]').filter((node) => node.data('sourceTypes')?.length === 1).forEach((node) => {
          const songs = node.neighborhood('[nodeType = "song"]');
          if (!songs.length) return;
          const neighbors = songs.union(songs.neighborhood('[nodeType = "artist"]'));
          const side = node.data('sourceTypes')[0] === 'covers' ? -1 : 1;
          const centerX = neighbors.reduce((sum, neighbor) => sum + neighbor.position('x'), 0) / neighbors.length;
          node.position({
            x: side * Math.max(400, side * centerX),
            y: neighbors.reduce((sum, neighbor) => sum + neighbor.position('y'), 0) / neighbors.length + 240,
          });
        });
      });
    }
    const graphLayout = cy.layout({
      ...layout,
      ...(layout.name === 'cola' && {
        randomize: !seedClusters,
        gapInequalities: [
          ...(central.length ? mixedReleases.toArray().flatMap((node) => [
            { axis: 'x', left: central, right: node, gap: -160 },
            { axis: 'x', left: node, right: central, gap: -160 },
          ]) : []),
          ...constraints.map(({ left, right }) => {
            const node = left === central ? right : left;
            return { axis: 'x', left, right, gap: 280 + node.layoutDimensions({ nodeDimensionsIncludeLabels: true }).w / 2 };
          }),
          ...cy.nodes('[nodeType = "artist"]').toArray().flatMap((node) => {
            const song = node.neighborhood('[nodeType = "song"]').first();
            if (!song.length) return [];
            const gap = (song.layoutDimensions({ nodeDimensionsIncludeLabels: true }).w
              + node.layoutDimensions({ nodeDimensionsIncludeLabels: true }).w) / 2 + 32;
            return [{ axis: 'x', left: song.data('sourceType') === 'covers' ? node : song,
              right: song.data('sourceType') === 'covers' ? song : node, gap }];
          }),
        ],
      }),
      ...(layout.name === 'fcose' && {
        relativePlacementConstraint: constraints.map(({ left, right }) => ({ left: left.id(), right: right.id(), gap: 160 })),
        ...(central.length && mixedReleases.length && {
          alignmentConstraint: { vertical: [[central.id(), ...mixedReleases.map((node) => node.id())]] },
        }),
      }),
    });
    this.graphLayout = graphLayout;
    graphLayout.one('layoutstop', () => {
      if (this.graphLayout === graphLayout && !cy.destroyed()) this.fitGraph(cy);
    });
    graphLayout.run();
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
    const cy = this.cy;
    let highlightedNodeId = null;
    const clearHighlight = () => {
      highlightedNodeId = null;
      cy.elements().removeClass('semitransp highlight');
    };
    cy.on('tap', 'node', (evt) => {
      cy.batch(() => {
        const node = evt.target;
        const wasHighlighted = highlightedNodeId === node.id();
        clearHighlight();
        if (wasHighlighted) return;
        highlightedNodeId = node.id();
        const connected = node.closedNeighborhood().union(node.successors()).union(node.predecessors());
        connected.addClass('highlight');
        cy.elements().difference(connected).addClass('semitransp');
      });
    });
    cy.on('tap', (evt) => {
      if (evt.target === cy) cy.batch(clearHighlight);
    });
  }

  onAlbumToggle = (albumId) => {
    this.setState(({ selectedAlbumIds }) => ({
      selectedAlbumIds: selectedAlbumIds.includes(albumId)
        ? selectedAlbumIds.filter((id) => id !== albumId)
        : [...selectedAlbumIds, albumId],
    }));
  };

  onSourceModeChange = (sourceMode) => {
    this.setState({ sourceMode, selectedAlbumIds: [] });
  };

  downloadGraph = () => {
    if (!this.cy || this.cy.destroyed()) return;
    let objectUrl;
    try {
      this.setState({ exportError: null });
      const { exportFormat } = this.state;
      const link = document.createElement('a');
      if (exportFormat === 'svg') {
        const content = this.cy.svg({ bg: '#ffffff', full: true });
        objectUrl = URL.createObjectURL(new Blob([content], { type: 'image/svg+xml;charset=utf-8' }));
        link.href = objectUrl;
      } else {
        link.href = this.cy.png({ bg: '#ffffff', full: true, maxWidth: 2400 });
      }
      link.download = `covers-${this.state.selectedArtistId}-${this.state.layoutName}.${exportFormat}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      this.setState({ exportError: error.message || 'Unable to export the graph image.' });
    } finally {
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }
  };

  async loadGraphForArtist(artistId) {
    try {
      const [coversResponse, originalsResponse] = await Promise.all([
        fetch(`/graphs/covers/${artistId}.json`),
        fetch(`/graphs/originals/${artistId}.json`),
      ]);
      if (!coversResponse.ok) {
        throw new Error('Generated data file not found. Run the Python data generator first.');
      }

      const payload = await coversResponse.json();
      const originalsPayload = originalsResponse.ok
        ? await originalsResponse.json()
        : { networkData: [] };
      const fallbackArtistImage =
        payload.artistPictureResolved || payload.artistPicture || payload.artist?.picture || null;
      const artistImageUrls = uniqueImageUrls([
        ...(Array.isArray(payload.artistPictures) ? payload.artistPictures : []),
        fallbackArtistImage,
      ]);

      const coversData = Array.isArray(payload.networkData) ? payload.networkData : [];
      const originalsData = Array.isArray(originalsPayload.networkData) ? originalsPayload.networkData : [];
      const nodeDataById = new Map();
      const edgeData = [];
      const appendGraphData = (items, sourceType) => {
        items.forEach((item) => {
          const data = item?.data || {};
          if (data.source || data.target) {
            edgeData.push({
              ...item,
              data: {
                ...data,
                id: `${sourceType}-edge:${data.source}->${data.target}`,
                relation: sourceType === 'originals' ? 'original-cover' : 'cover-version',
                sourceType,
              },
            });
            return;
          }
          if (!data.id) return;
          const previous = nodeDataById.get(data.id);
          const nodeType = data.nodeType || 'song';
          const graphReleases = nodeType === 'song'
            ? (sourceType === 'originals' ? data.releases : data.coverReleases) || []
            : [];
          const sourceTypes = [...new Set([...(previous?.sourceTypes || []), sourceType])];
          const mergedReleases = new Map([
            ...((previous?.graphReleases || []).map((release) => [release.uri, release])),
            ...graphReleases.map((release) => [release.uri, release]),
          ]);
          nodeDataById.set(data.id, {
            ...previous,
            ...data,
            nodeType,
            ...(nodeType === 'artist' && {
              sourceTypes,
              artistRole: sourceTypes.length > 1 ? 'both'
                : sourceType === 'covers' ? 'original-performer' : 'cover-performer',
              imageUrl: isValidImageUrl(data.imageUrl) ? data.imageUrl : previous?.imageUrl || null,
            }),
            ...(nodeType === 'song' && { sourceType, sourceTypes, graphReleases: [...mergedReleases.values()] }),
          });
        });
      };
      appendGraphData(coversData, 'covers');
      appendGraphData(originalsData, 'originals');
      const payloadData = [...[...nodeDataById.values()].map((data) => ({ data })), ...edgeData];
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
        .filter((item) => item?.data?.nodeType === 'song')
        .map((item) => item.data);
      const songsById = new Map(payloadSongs.map((song) => [song.id, song]));
      const releaseCoverCounts = new Map();
      payloadSongs.forEach((song) => {
        const releases = new Set((song.coverReleases || []).map((release) => release?.uri).filter(Boolean));
        releases.forEach((uri) => releaseCoverCounts.set(uri, (releaseCoverCounts.get(uri) || 0) + 1));
      });

      const typedNetworkData = payloadData.map((item) => {
        const data = item?.data || {};
        if (data.source || data.target) {
          const sourceSong = songsById.get(data.source);
          const primaryRelease = sourceSong ? getOrderedReleases([sourceSong])[0] : null;
          return {
            ...item,
            data: {
              ...data,
              id: data.id || `edge:${data.source}->${data.target}`,
              coverCount: primaryRelease ? releaseCoverCounts.get(primaryRelease.uri) || 1 : 1,
            },
          };
        }
        const nodeType = data.nodeType || (targetIds.has(data.id) ? 'artist' : sourceIds.has(data.id) ? 'song' : 'artist');
        return {
          ...item,
          data: {
            ...data,
            nodeType,
            ...(nodeType === 'artist' && { label: formatArtistName(data.label || '') }),
            ...(nodeType === 'song' && { label: formatSongTitle(data.label || '') }),
            ...(nodeType === 'artist' && { imageUrl: isValidImageUrl(data.imageUrl) ? data.imageUrl : null }),
          },
        };
      });
      const selectedNodeId = `selected-artist-${artistId}`;
      const albumNodes = new Map();
      const albumEdges = [];
      const ungroupedSongs = [];
      typedNetworkData.filter((item) => item.data.nodeType === 'song').forEach(({ data }) => {
        const releases = releasesForSong(data);
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
                entitySubType: release.entitySubType || 'album',
                uri: release.uri,
                coverCount: releaseCoverCounts.get(release.uri) || 1,
                sourceTypes: [],
                releaseDetails: release.releaseDetails || null,
                date: release.date || null,
                year: release.year || null,
                imageUrl: isValidImageUrl(release.imageUrl) ? release.imageUrl : null,
              },
            });
          }
          const albumData = albumNodes.get(albumId).data;
          albumData.sourceTypes = [...new Set([...albumData.sourceTypes, ...(data.sourceTypes || [data.sourceType])])];
          if (!albumData.imageUrl && isValidImageUrl(release.imageUrl)) albumData.imageUrl = release.imageUrl;
          albumEdges.push({ data: {
            id: `edge:${albumId}->${data.id}`,
            source: albumId,
            target: data.id,
            relation: 'album-track',
            sourceType: data.sourceType,
            coverCount: releaseCoverCounts.get(release.uri) || 1,
          } });
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
          data: {
            id: `edge:${selectedNodeId}->${target}`,
            source: selectedNodeId,
            target,
            relation: 'cover',
            coverCount: albumNodes.get(target)?.data.coverCount || 1,
          },
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
        originalsCount: Number(originalsPayload.originalsCount || payloadSongs.filter((song) => song.sourceType === 'originals').length),
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
      searchQuery,
      searchType,
      exportFormat,
      exportError,
      sourceMode,
      layoutName,
      coversCount,
      originalsCount,
      networkData,
      canvasContainerWidth,
      canvasContainerHeight,
      partialData,
    } = this.state;
    const hasNetworkData = Array.isArray(networkData) && networkData.length > 0;
    const allSongs = networkData.filter((item) => item.data?.nodeType === 'song');
    const songs = allSongs.filter((item) => sourceMode === 'both'
      || (item.data.sourceTypes || [item.data.sourceType]).includes(sourceMode));
    const activeReleaseIds = new Set(songs.flatMap(({ data }) => releasesForSong(data)
      .map((release) => release?.uri).filter(Boolean)));
    const albums = networkData
      .filter((item) => item.data?.nodeType === 'album')
      .filter((item) => sourceMode === 'both'
        || (item.data.sourceTypes || []).includes(sourceMode)
        || activeReleaseIds.has(item.data.uri))
      .sort((first, second) => (first.data.year || Infinity) - (second.data.year || Infinity)
        || first.data.label.localeCompare(second.data.label));
    const albumSongCounts = new Map(albums.map((item) => [item.data.id, 0]));
    songs.forEach(({ data }) => releasesForSong(data).forEach((release) => {
      const albumId = `album:${release.uri}`;
      if (albumSongCounts.has(albumId)) albumSongCounts.set(albumId, albumSongCounts.get(albumId) + 1);
    }));
    const ungroupedCount = songs.filter((item) => item.data.ungrouped).length;
    const query = searchQuery.trim().toLocaleLowerCase();
    const matchesSearch = (data) => (data.label || '').toLocaleLowerCase().includes(query);
    const matchingAlbumIds = new Set(albums.filter((item) => matchesSearch(item.data)).map((item) => item.data.id));
    const matchingArtistIds = new Set(networkData.filter((item) => item.data?.nodeType === 'artist'
      && matchesSearch(item.data)).map((item) => item.data.id));
    const artistSongIds = new Set(networkData.filter((item) => matchingArtistIds.has(item.data?.target))
      .map((item) => item.data.source));
    const selectedArtistMatches = networkData.some((item) => item.data?.nodeType === 'selectedArtist' && matchesSearch(item.data));
    const visibleSongIds = new Set(songs.filter((item) => (selectedAlbumIds.length === 0
      || (item.data.ungrouped && selectedAlbumIds.includes(UNGROUPED_ALBUM_ID))
      || releasesForSong(item.data).some((release) => selectedAlbumIds.includes(`album:${release.uri}`)))
      && (!query || (searchType === 'song' ? matchesSearch(item.data)
        : searchType === 'album' ? releasesForSong(item.data).some((release) => matchingAlbumIds.has(`album:${release.uri}`))
          : selectedArtistMatches || artistSongIds.has(item.data.id))))
      .map((item) => item.data.id));
    const songAlbumIds = new Set(songs.filter((item) => visibleSongIds.has(item.data.id))
      .flatMap((item) => releasesForSong(item.data).map((release) => `album:${release.uri}`)));
    const visibleAlbumIds = new Set(albums.filter((item) => (selectedAlbumIds.length === 0
      || selectedAlbumIds.includes(item.data.id)) && (!query || songAlbumIds.has(item.data.id))
      && (!query || searchType !== 'album' || matchingAlbumIds.has(item.data.id))).map((item) => item.data.id));
    const visibleArtistIds = new Set(networkData.filter((item) => visibleSongIds.has(item.data?.source)
      && item.data?.target && (!query || searchType !== 'artist' || selectedArtistMatches
        || matchingArtistIds.has(item.data.target))).map((item) => item.data.target));
    const visibleNodeIds = new Set(networkData.filter((item) => item.data?.nodeType === 'selectedArtist'
      || visibleSongIds.has(item.data?.id) || visibleAlbumIds.has(item.data?.id)
      || visibleArtistIds.has(item.data?.id)).map((item) => item.data.id));
    const visibleNetworkData = networkData.filter((item) => item.data?.source && item.data?.target
      ? visibleNodeIds.has(item.data.source) && visibleNodeIds.has(item.data.target)
      : visibleNodeIds.has(item.data?.id));
    const layout = {
      name: layoutName,
      animate: false,
      fit: false,
      nodeDimensionsIncludeLabels: true,
      ...(layoutName === 'cola' ? {
        animate: true,
        refresh: 1,
        randomize: true,
        avoidOverlap: true,
        handleDisconnected: true,
        nodeSpacing: (node) => node.data('nodeType') === 'selectedArtist' ? 72
          : node.data('nodeType') === 'album' ? 48 : 12,
        edgeLength: (edge) => edge.data('relation') === 'cover'
          ? (edge.target().data('nodeType') === 'album' && edge.target().data('sourceTypes')?.length === 1 ? 450 : 260)
          : edge.data('relation') === 'album-track'
            ? (edge.source().data('sourceTypes')?.length === 1 ? 100 : 180) : 60,
        maxSimulationTime: 1500,
        convergenceThreshold: 0.01,
      } : {}),
      ...(layoutName === 'fcose' ? {
        quality: 'proof',
        packComponents: true,
        nodeSeparation: 24,
        nodeRepulsion: (node) => node.data('nodeType') === 'selectedArtist' ? 12000
          : node.data('nodeType') === 'album' ? 6500 : 4500,
        idealEdgeLength: (edge) => edge.data('relation') === 'cover'
          ? (edge.target().data('nodeType') === 'album' && edge.target().data('sourceTypes')?.length === 1 ? 300 : 150)
          : edge.data('relation') === 'album-track'
            ? (edge.source().data('sourceTypes')?.length === 1 ? 70 : 100) : 65,
        edgeElasticity: (edge) => edge.data('relation') === 'cover' ? 0.35 : 0.8,
        gravity: 0.4,
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
          <aside className='covers-side-panel' aria-label='Album, EP and single filters'>
            <h1>{artist?.commonName || ARTIST_OPTIONS.find((option) => String(option.id) === this.state.selectedArtistId)?.name}</h1>
            {!loading && !error && (
              <p className='covers-side-count'>
                {visibleSongIds.size} tracks shown · {sourceMode === 'both' ? `${coversCount} covers / ${originalsCount} originals` : sourceMode}
                {partialData ? ' (partial)' : ''}
              </p>
            )}
            <div className='covers-source-switch' role='group' aria-label='Graph sources'>
              {SOURCE_MODES.map((mode) => (
                <button
                  key={mode.value}
                  type='button'
                  aria-pressed={sourceMode === mode.value}
                  className={sourceMode === mode.value ? 'is-active' : ''}
                  onClick={() => this.onSourceModeChange(mode.value)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <div className='covers-search-controls'>
              <label htmlFor='covers-search-type'>Search by</label>
              <select id='covers-search-type' value={searchType} onChange={(event) => this.setState({ searchType: event.target.value })}>
                <option value='album'>Album / EP / single</option>
                <option value='song'>Song</option>
                <option value='artist'>Artist</option>
              </select>
              <div className='covers-search-input'>
                <FaSearch aria-hidden='true' />
                <input id='covers-search' type='search' aria-label='Search graph' placeholder='Search' value={searchQuery} onChange={(event) => this.setState({ searchQuery: event.target.value })} />
                {searchQuery && <button type='button' aria-label='Clear search' title='Clear search' onClick={() => this.setState({ searchQuery: '' })}><FaTimes aria-hidden='true' /></button>}
              </div>
            </div>
            <div className='covers-artist-legend' aria-label='Artist roles'>
              <span><i className='covers-role-marker is-original' aria-hidden='true' /> Original performers</span>
              <span><i className='covers-role-marker is-cover' aria-hidden='true' /> Cover performers</span>
              {networkData.some((item) => item.data?.artistRole === 'both') && (
                <span><i className='covers-role-marker is-both' aria-hidden='true' /> Both roles</span>
              )}
            </div>
            <div className='covers-filter-heading'>
              <h2 className='covers-side-heading'>Releases</h2>
              <button type='button' className='covers-filter-reset' onClick={() => this.setState({ selectedAlbumIds: [] })} disabled={selectedAlbumIds.length === 0}>
                <FaUndo aria-hidden='true' /> Show all
              </button>
            </div>
            <div className='covers-graph-controls'>
              <label htmlFor='covers-layout-select'>Layout</label>
              <select id='covers-layout-select' value={layoutName} onChange={(event) => this.setState({ layoutName: event.target.value })}>
                {LAYOUT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <label htmlFor='covers-export-format'>Download format</label>
              <select id='covers-export-format' value={exportFormat} onChange={(event) => this.setState({ exportFormat: event.target.value, exportError: null })}>
                <option value='png'>PNG</option>
                <option value='svg'>SVG</option>
              </select>
              <button type='button' className='covers-export-button' onClick={this.downloadGraph} disabled={loading || error || visibleSongIds.size === 0}>
                <FaDownload aria-hidden='true' /> Download {exportFormat.toUpperCase()}
              </button>
              {exportError && <p role='alert' className='text-danger mb-0'>{exportError}</p>}
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
                    <span className='covers-album-title'>No release</span>
                    <span className='covers-album-count'>{ungroupedCount}</span>
                  </label>
                )}
              </div>
            )}
          </aside>
          <div id='canvasContainer' ref={this.canvasCoversContainer} className='canvas-container'>
            {!loading && !error && hasNetworkData && visibleSongIds.size > 0 && (
              <CytoscapeComponent
                key={`${sourceMode}:${layoutName}:${searchType}:${query}:${selectedAlbumIds.slice().sort().join('|') || 'all'}`}
                elements={visibleNetworkData}
                cy={(cy) => {
                  if (this.cy === cy) return;
                  this.cy = cy;
                  this.initListeners();
                  this.runGraphLayout(cy, layout);
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
                      'text-events': 'yes',
                      'background-opacity': 0,
                      'text-wrap': 'wrap',
                      'text-max-width': 200,
                    },
                  },
                  {
                    selector: 'node[nodeType = "artist"]',
                    style: {
                      shape: 'ellipse',
                      width: 96,
                      height: 96,
                      'border-width': 0,
                      'background-opacity': 0,
                      'background-image': (ele) => ele.data('imageUrl') || 'none',
                      'background-fit': 'cover',
                      'background-image-opacity': 1,
                      color: '#236978',
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
                    selector: 'node[artistRole = "cover-performer"]',
                    style: {
                      color: '#b8683e',
                    },
                  },
                  {
                    selector: 'node[artistRole = "both"]',
                    style: {
                      color: '#58713d',
                    },
                  },
                  {
                    selector: 'node[nodeType = "artist"][!imageUrl]',
                    style: {
                      width: 96,
                      height: 96,
                      'background-color': '#e3e9e6',
                      'background-opacity': 1,
                      'font-size': 12,
                      'text-valign': 'center',
                      'text-margin-y': 0,
                      'text-overflow-wrap': 'whitespace',
                      'text-max-width': 82,
                    },
                  },
                  {
                    selector: 'node[nodeType = "song"]',
                    style: {
                      shape: 'rectangle',
                      color: (ele) => getSongColor(ele.data()),
                      'font-family': 'Kreon',
                      'font-size': 30,
                      'font-weight': 700,
                      width: 1,
                      height: 1,
                      padding: 8,
                      'background-opacity': 0,
                      'background-image': 'none',
                      'border-width': 0,
                      'text-halign': 'center',
                      'text-valign': 'center',
                      'text-margin-y': 0,
                      'text-wrap': 'wrap',
                      'text-overflow-wrap': 'whitespace',
                      'text-max-width': 190,
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
                      'border-width': 0,
                    },
                  },
                  {
                    selector: 'node[nodeType = "album"][!imageUrl]',
                    style: {
                      width: 106.667,
                      height: 106.667,
                      'background-color': '#e3e9e6',
                      'background-opacity': 1,
                      color: '#252b28',
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
                      'border-width': 0,
                      label: '',
                    },
                  },
                  {
                    selector: 'edge',
                    style: {
                      'line-color': '#474d49',
                      width: 1.2,
                      color: '#252b28',
                      opacity: 0.22,
                      'line-style': 'solid',
                      'curve-style': 'straight',
                    },
                  },
                  {
                    selector: 'edge[relation = "cover"]',
                    style: {
                      'line-color': '#353b37',
                      width: getReleaseEdgeWidth,
                      opacity: 0.16,
                    },
                  },
                  {
                    selector: 'edge[relation = "album-track"]',
                    style: {
                      'line-color': (ele) => getSongColor(ele.target().data()),
                      width: 1.4,
                    },
                  },
                  {
                    selector: 'edge[sourceType = "covers"]',
                    style: { 'line-style': 'dotted' },
                  },
                  {
                    selector: 'node.highlight',
                    style: {
                      opacity: 1,
                      'text-outline-color': '#ffffff',
                      'text-outline-width': 2,
                      'z-index': 20,
                    },
                  },
                  {
                    selector: 'node.semitransp',
                    style: { opacity: 0.15 },
                  },
                  {
                    selector: 'edge.highlight',
                    style: { opacity: 0.75 },
                  },
                  {
                    selector: 'edge.semitransp',
                    style: { opacity: 0.06 },
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
            {!loading && !error && hasNetworkData && visibleSongIds.size === 0 && (
              <div className='container pt-4' role='status'><p>No matching tracks.</p></div>
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
