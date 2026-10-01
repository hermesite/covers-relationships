import Cytoscape from 'cytoscape';
import React, { Component } from 'react';
import CytoscapeComponent from 'react-cytoscapejs';
import fcose from 'cytoscape-fcose';

import { ARTIST_OPTIONS } from '../../constants/artistOptions';

Cytoscape.use(fcose);

class Originals extends Component {
  constructor() {
    super();
    this.state = {
      selectedArtistId: String(ARTIST_OPTIONS[0].id),
      loading: true,
      error: null,
      artist: null,
      originalsCount: 0,
      artistsCoveringCount: 0,
      coversTotal: 0,
      networkData: [],
      canvasContainerWidth: window.innerWidth,
      canvasContainerHeight: Math.max(window.innerHeight * 0.6, 400),
      partialData: false,
    };
    this.canvasOriginalsContainer = React.createRef();
    this.isMountedFlag = false;
  }

  componentDidMount() {
    this.isMountedFlag = true;
    this.loadGraphForArtist(Number(this.state.selectedArtistId));
  }

  componentWillUnmount() {
    this.isMountedFlag = false;
  }

  initListeners() {
    this.cy.on('mouseover', 'node', (evt) => {
      const node = evt.target;
      const isSong = node.data('nodeType') === 'song';
      const relatedElements = isSong ? node.outgoers() : node.incomers();
      this.cy.elements().difference(relatedElements).not(node).addClass('semitransp');
      node.addClass('highlight');
      relatedElements.addClass('highlight');
    });

    this.cy.on('mouseout', 'node', (evt) => {
      const node = evt.target;
      this.cy.elements().removeClass('semitransp');
      node.removeClass('highlight');
      node.incomers().removeClass('highlight');
      node.outgoers().removeClass('highlight');
    });

    this.cy.on('click', 'node', (evt) => {
      const node = evt.target;
      if (node.data('nodeType') === 'song') {
        this.cy.fit(this.cy.$(node.outgoers()));
      } else {
        this.cy.fit(this.cy.$(node.incomers()));
      }
    });
  }

  onArtistChange = async (event) => {
    const selectedArtistId = event.target.value;
    this.setState({
      selectedArtistId,
      loading: true,
      error: null,
      originalsCount: 0,
      artistsCoveringCount: 0,
      coversTotal: 0,
      networkData: [],
      partialData: false,
    });
    await this.loadGraphForArtist(Number(selectedArtistId));
  };

  async loadGraphForArtist(artistId) {
    try {
      const response = await fetch(`/data/graphs/originals/${artistId}.json`);
      if (!response.ok) {
        throw new Error('Generated data file not found. Run the Python data generator first.');
      }

      const payload = await response.json();
      const containerWidth = this.canvasOriginalsContainer.current?.offsetWidth || window.innerWidth;
      const containerHeight =
        this.canvasOriginalsContainer.current?.offsetHeight || Math.max(window.innerHeight * 0.6, 400);

      if (!this.isMountedFlag) return;
      this.setState({
        loading: false,
        error: payload.error || null,
        artist: payload.artist || null,
        originalsCount: Number(payload.originalsCount || 0),
        artistsCoveringCount: Number(payload.artistsCoveringCount || 0),
        coversTotal: Number(payload.coversTotal || 0),
        networkData: Array.isArray(payload.networkData) ? payload.networkData : [],
        canvasContainerWidth: containerWidth,
        canvasContainerHeight: containerHeight,
        partialData: Boolean(payload.partialData),
      });
    } catch (error) {
      if (!this.isMountedFlag) return;
      this.setState({
        loading: false,
        error: error?.message || 'Failed to load originals data.',
      });
    }
  }

  render() {
    const {
      loading,
      error,
      artist,
      originalsCount,
      artistsCoveringCount,
      coversTotal,
      networkData,
      canvasContainerWidth,
      canvasContainerHeight,
      selectedArtistId,
      partialData,
    } = this.state;

    const hasNetworkData = Array.isArray(networkData) && networkData.length > 0;
    const layout = {
      name: 'fcose',
      animate: false,
      quality: 'proof',
    };

    return (
      <section>
        <div id='canvasContainer' ref={this.canvasOriginalsContainer} className='canvas-container'>
          {!loading && !error && hasNetworkData && (
            <CytoscapeComponent
              elements={networkData}
              layout={layout}
              cy={(cy) => {
                this.cy = cy;
                this.initListeners();
                cy.layout(layout).run();
                cy.fit();
              }}
              style={{
                width: canvasContainerWidth,
                height: canvasContainerHeight,
              }}
              stylesheet={[
                {
                  selector: 'node',
                  style: {
                    color: (ele) => (ele.isNode() ? ele.data('color') : null),
                    'font-size': (ele) => (ele.isNode() ? ele.data('fontSize') : null),
                    width: (ele) => (ele.isNode() ? ele.data('size') : null),
                    height: (ele) => (ele.isNode() ? ele.data('size') : null),
                    'background-color': (ele) => (ele.isNode() ? ele.data('bgColor') : null),
                    label: (ele) => (ele.isNode() ? ele.data('label') : null),
                    opacity: (ele) => (ele.isNode() ? ele.data('opacity') : null),
                    'font-family': (ele) => (ele.isNode() ? ele.data('fontFamily') : null),
                    'text-valign': 'center',
                    'background-opacity': (ele) => (ele.isNode() ? ele.data('bgOpacity') : null),
                    'text-wrap': 'wrap',
                    'text-max-width': (ele) => (ele.isNode() ? ele.data('size') - 10 : null),
                  },
                },
                {
                  selector: 'edge',
                  style: {
                    'line-color': (ele) => (ele.isEdge() ? ele.data('color') : null),
                    width: (ele) => (ele.isEdge() ? ele.data('weight') : null),
                    color: (ele) => (ele.isEdge() ? ele.data('color') : null),
                    opacity: (ele) => (ele.isEdge() ? ele.data('opacity') : null),
                  },
                },
                {
                  selector: 'edge.highlight',
                  style: { opacity: '0.5' },
                },
                {
                  selector: 'edge.semitransp',
                  style: { opacity: '0.1' },
                },
                {
                  selector: 'node.semitransp',
                  style: { opacity: '0.1' },
                },
              ]}
            />
          )}
          {loading && (
            <div className='container pt-4'>
              <p>Loading originals graph...</p>
            </div>
          )}
          {!loading && !error && !hasNetworkData && (
            <div className='container pt-4'>
              <p>No graph data available for this artist.</p>
            </div>
          )}
        </div>

        <div className='container graph-page-header'>
          <div className='graph-toolbar'>
            <label htmlFor='originals-artist-select'>Artist</label>
            <select
              id='originals-artist-select'
              value={selectedArtistId}
              onChange={this.onArtistChange}
              disabled={loading}
            >
              {ARTIST_OPTIONS.map((option) => (
                <option key={option.id} value={String(option.id)}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div className='pt-3'>
              <h1>Originals</h1>
              <p>Unable to render originals graph.</p>
              <p>
                <small>{error}</small>
              </p>
            </div>
          )}

          {!loading && !error && artist && (
            <header className='pt-3'>
              <h1>{artist.commonName}</h1>
              <div className='row'>
                <div className='col col-auto'>
                  <p>originals</p>
                  <h2>{originalsCount}</h2>
                </div>
                <div className='col col-auto'>
                  <p>artists covering</p>
                  <h2>{artistsCoveringCount}</h2>
                </div>
                <div className='col col-auto'>
                  <p>covers</p>
                  <h2>{coversTotal}</h2>
                </div>
                {partialData && (
                  <div className='col col-auto'>
                    <p>data scope</p>
                    <h2>partial</h2>
                  </div>
                )}
              </div>
            </header>
          )}
        </div>
      </section>
    );
  }
}

export default Originals;
