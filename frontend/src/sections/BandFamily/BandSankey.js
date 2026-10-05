import React, { useMemo } from 'react';
import { sankey, sankeyLeft, sankeyLinkHorizontal } from 'd3-sankey';

const VIEW_WIDTH = 1700;

function buildSankey(routes, stationData) {
  const stationById = new Map(stationData.map((station) => [station.id, station]));
  const stationRoutes = new Map();
  routes.forEach((route) => route.stops.forEach((stationId) => {
    if (!stationRoutes.has(stationId)) stationRoutes.set(stationId, []);
    stationRoutes.get(stationId).push(route);
  }));
  const stations = [...stationRoutes].map(([id, memberships]) => ({
    ...stationById.get(id),
    name: stationById.get(id)?.label || id,
  }));
  const bandNodes = routes.map((route) => ({
    id: `route:${route.id}`,
    type: 'band',
    name: route.name,
    color: route.color,
    central: route.central,
  }));
  const links = routes.flatMap((route) => route.stops.map((stationId) => ({
    source: stationId,
    target: `route:${route.id}`,
    routeId: route.id,
    routeName: route.name,
    color: route.color,
    value: 1,
  })));
  const graphHeight = Math.max(760, Math.min(6200, 280 + stations.length * 10 + routes.length * 7));
  const layout = sankey()
    .nodeId((node) => node.id)
    .nodeAlign(sankeyLeft)
    .nodeWidth(16)
    .nodePadding(6)
    .nodeSort((first, second) => Number(second.centralMember || second.stationType === 'transfer') - Number(first.centralMember || first.stationType === 'transfer')
      || first.name.localeCompare(second.name))
    .extent([[300, 20], [VIEW_WIDTH - 240, graphHeight - 20]])
    .iterations(8);
  return { graph: layout({ nodes: [...stations, ...bandNodes], links }), height: graphHeight };
}

export default function BandSankey({ routes, stations, selectedRouteId, selectedStationId, onSelectRoute, onSelectStation }) {
  const { graph, height } = useMemo(() => buildSankey(routes, stations), [routes, stations]);
  if (!graph.nodes.length || !graph.links.length) return null;
  const path = sankeyLinkHorizontal();
  const visibleStationLabelCount = graph.nodes.filter((node) => node.type === 'station'
    && (node.centralMember || node.stationType === 'transfer')).length;

  return (
    <section className='band-family-sankey' aria-labelledby='band-family-sankey-heading'>
      <header className='band-family-sankey-heading'>
        <div>
          <h2 id='band-family-sankey-heading'>Membership flow</h2>
          <p>Shared member stations connect each band route · {graph.links.length} memberships</p>
        </div>
      </header>
      <div className='band-family-sankey-scroll' role='region' aria-label='Sankey diagram of member and band connections' tabIndex={0}>
        <svg className='band-family-sankey-svg' viewBox={`0 0 ${VIEW_WIDTH} ${height}`} width={VIEW_WIDTH} height={height} role='group' aria-labelledby='band-family-sankey-title band-family-sankey-description'>
          <title id='band-family-sankey-title'>Band and member connections</title>
          <desc id='band-family-sankey-description'>Members are shared source nodes linked to every band route where they appear. Larger member nodes indicate transfers between more bands.</desc>
          <g className='band-family-sankey-links'>
            {graph.links.map((link) => (
              <path key={`${link.routeId}:${link.source.id}`} d={path(link)} fill='none'
                stroke={link.color} strokeOpacity={selectedRouteId && selectedRouteId !== link.routeId ? 0.08 : 0.28}
                strokeWidth={Math.max(1, link.width)}
                className={selectedRouteId === link.routeId ? 'is-selected' : ''}
                onClick={() => onSelectRoute(link.routeId)} tabIndex={0} role='button'
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectRoute(link.routeId); } }}>
                <title>{`${link.source.name} · ${link.routeName}`}</title>
              </path>
            ))}
          </g>
          <g className='band-family-sankey-nodes'>
            {graph.nodes.map((node) => {
              const isBand = node.type === 'band';
              const isTransfer = !isBand && node.stationType === 'transfer';
              const selected = isBand ? selectedRouteId === node.id.replace(/^route:/, '') : selectedStationId === node.id;
              const labelStation = node.centralMember || isTransfer || visibleStationLabelCount < 45;
              const onSelect = () => (isBand ? onSelectRoute(node.id.replace(/^route:/, '')) : onSelectStation(node.id));
              return (
                <g key={node.id} className={`band-family-sankey-node${selected ? ' is-selected' : ''}${isBand ? ' is-band' : isTransfer ? ' is-transfer' : ' is-member'}`}
                  role='button' tabIndex={0} aria-label={`${node.name}${isBand ? ' band' : isTransfer ? ', transfer member' : ', member'}`}
                  onClick={onSelect} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(); } }}>
                  <rect x={node.x0} y={node.y0} width={Math.max(2, node.x1 - node.x0)} height={Math.max(2, node.y1 - node.y0)}
                    rx={isBand ? 2 : Math.min((node.y1 - node.y0) / 2, 5)}
                    fill={isBand ? (node.central ? '#344a4d' : node.color) : isTransfer ? '#f1c66d' : '#e5ece8'}
                    stroke={node.central ? '#dda83f' : isTransfer ? '#344a4d' : '#61746a'}
                    strokeWidth={selected || node.central ? 2 : 1} />
                  {(isBand || labelStation) && (
                    <text x={isBand ? node.x1 + 7 : node.x0 - 7} y={(node.y0 + node.y1) / 2}
                      textAnchor={isBand ? 'start' : 'end'} dominantBaseline='middle'
                      className={node.central ? 'is-central' : ''}>
                      {node.name}
                    </text>
                  )}
                  <title>{isBand ? node.name : `${node.name}: member of ${node.sourceLinks.length} band routes`}</title>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </section>
  );
}
