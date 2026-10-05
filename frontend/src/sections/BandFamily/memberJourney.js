import { datePosition, getMemberTimeline } from '../BandDetail/memberTimeline.js';
import { path as createPath } from 'd3';

function bandKey(name = '') {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
}

export function getMemberJourney({ artist, relations = [], details = [], network = {} }) {
  const timeline = getMemberTimeline(artist, relations);
  const centralNameKey = bandKey(artist?.name);
  const centralKey = centralNameKey === 'joneses' ? 'thejoneses' : centralNameKey;
  const networkMembers = (network.nodes || []).filter((node) => node.type === 'artist' && node.selectedBandMember);
  const imagesById = new Map(networkMembers.map((member) => [member.id.replace(/^artist:/, ''), member.imageUrl]));
  details.forEach((member) => {
    if (member.imageUrl) imagesById.set(member.id, member.imageUrl);
  });
  const rows = timeline.rows.map((row, index) => ({
    ...row, index, color: row.roles[0]?.color || '#707a76', imageUrl: imagesById.get(row.id) || null,
    periods: row.periods.map((period) => ({
      ...period,
      start: Math.max(timeline.startYear, datePosition(period.begin) ?? timeline.startYear),
      finish: Math.min(timeline.endYear + 1, datePosition(period.end, true) ?? timeline.endYear + 1),
    })),
  }));
  networkMembers.forEach((member) => {
    const id = member.id.replace(/^artist:/, '');
    if (!rows.some((row) => row.id === id)) rows.push({
      id, name: member.name, index: rows.length, color: '#707a76', imageUrl: imagesById.get(id) || null,
      roles: [{ name: 'Role not recorded', color: '#707a76' }], periods: [],
    });
  });
  const membersById = new Map(rows.map((row) => [row.id, row]));
  const bands = new Map();
  const addMembership = (memberId, band, membership = {}) => {
    const member = membersById.get(memberId);
    const nameKey = bandKey(band.name);
    const key = nameKey === 'joneses' ? 'thejoneses' : nameKey;
    if (!member || !key || key === centralKey) return;
    if (!bands.has(key)) bands.set(key, {
      id: key, name: key === 'thejoneses' ? 'The Joneses' : band.name, url: band.url, memberships: new Map(),
    });
    const target = bands.get(key);
    if (nameKey === 'thejoneses' && band.url) target.url = band.url;
    if (!target.memberships.has(memberId)) target.memberships.set(memberId, {
      memberId, color: member.color, periods: [],
    });
    const entry = target.memberships.get(memberId);
    const begin = datePosition(membership.begin);
    const end = datePosition(membership.end);
    if ((begin !== null || end !== null) && !entry.periods.some((period) => period.begin === begin && period.end === end)) {
      entry.periods.push({ begin, end });
    }
  };
  const nodesById = new Map((network.nodes || []).map((node) => [node.id, node]));
  (network.edges || []).forEach((edge) => {
    const band = nodesById.get(edge.target);
    if (band?.type === 'band' && !band.central) addMembership(edge.source.replace(/^artist:/, ''), band, edge);
  });
  details.forEach((member) => {
    [...(member.memberOf || []), ...(member.discogsMemberOf || []), ...(member.musicbrainzMemberOf || [])]
      .forEach((band) => addMembership(member.id, band, band));
  });
  rows.forEach((member) => {
    member.connectionCount = [...bands.values()].filter((band) => band.memberships.has(member.id)).length;
  });
  rows.sort((first, second) => first.connectionCount - second.connectionCount || first.name.localeCompare(second.name));
  const julien = rows.find((member) => bandKey(member.name) === 'julienhechtlinger' && member.connectionCount > 0);
  if (centralKey === 'thecramps' && julien) {
    const precedingMembers = ['luxinterior', 'poisonivy'].map((name) => rows.find((member) =>
      bandKey(member.name) === name && member.connectionCount > 0)).filter(Boolean);
    precedingMembers.forEach((member) => rows.splice(rows.indexOf(member), 1));
    rows.splice(rows.indexOf(julien), 0, ...precedingMembers);
  }
  rows.forEach((member, index) => { member.index = index; });
  const stops = [...bands.values()].map((band) => {
    const memberships = [...band.memberships.values()].map((entry) => {
      const begins = entry.periods.map((period) => period.begin).filter((year) => year !== null);
      const ends = entry.periods.map((period) => period.end).filter((year) => year !== null);
      return { ...entry, year: begins.length ? Math.min(...begins) : ends.length ? Math.min(...ends) : null,
        uncertain: !begins.length };
    }).sort((first, second) => membersById.get(first.memberId).index - membersById.get(second.memberId).index);
    const years = memberships.map((entry) => entry.year).filter((year) => year !== null);
    return { ...band, memberships, year: years.length ? Math.min(...years) : null,
      lastYear: years.length ? Math.max(...years) : null,
      row: memberships.reduce((sum, entry) => sum + membersById.get(entry.memberId).index, 0) / memberships.length };
  }).sort((first, second) => (first.year ?? Infinity) - (second.year ?? Infinity) || first.name.localeCompare(second.name));
  const datedYears = stops.flatMap((stop) => stop.memberships.map((entry) => entry.year)).filter((year) => year !== null);
  const startYear = Math.floor(Math.min(timeline.startYear - 2, ...datedYears));
  const endYear = Math.ceil(Math.max(timeline.endYear + 2, ...datedYears));
  return { rows, stops, startYear, endYear, bandStart: timeline.startYear,
    bandEnd: timeline.endYear + 1, bandName: artist?.name || 'Selected band', legend: timeline.legend };
}

export const JOURNEY_STROKE_WIDTH = 4;
export const JOURNEY_LINE_GAP = 8;
export const JOURNEY_PORTRAIT_SIZE = 60;
export const JOURNEY_BAND_RADIUS = 6;

export function wrapJourneyLabel(name, maxLength = 18) {
  const lines = [''];
  name.split(/\s+/).forEach((word) => {
    const chunks = word.match(new RegExp(`.{1,${maxLength}}`, 'gu')) || [];
    chunks.forEach((chunk) => {
      const index = lines.length - 1;
      if (lines[index] && `${lines[index]} ${chunk}`.length > maxLength) lines.push(chunk);
      else lines[index] = `${lines[index]} ${chunk}`.trim();
    });
  });
  return lines;
}

export function layoutCompactJourney(journey, availableWidth = 0) {
  const pitch = JOURNEY_STROKE_WIDTH + JOURNEY_LINE_GAP;
  const connectedRows = journey.rows.filter((member) => journey.stops.some((stop) => stop.memberships.some((entry) => entry.memberId === member.id)));
  const unconnectedRows = journey.rows.filter((member) => !connectedRows.includes(member));
  const headerHeight = unconnectedRows.length ? JOURNEY_PORTRAIT_SIZE + 72 : 0;
  const columnCount = Math.max(1, Math.min(4, Math.ceil(journey.stops.length / 24)));
  const columns = Array.from({ length: columnCount }, () => ({ height: 0, stops: [] }));
  const ordered = [...journey.stops].sort((first, second) => first.row - second.row || first.name.localeCompare(second.name));
  ordered.forEach((stop) => {
    const column = columns.reduce((best, candidate) => candidate.height < best.height ? candidate : best);
    const lines = wrapJourneyLabel(stop.name, 24);
    const radius = JOURNEY_BAND_RADIUS;
    const stopPitch = radius * 2 + JOURNEY_STROKE_WIDTH + JOURNEY_LINE_GAP;
    const span = Math.max(0, stop.memberships.length - 1) * stopPitch;
    const height = Math.max(span + radius * 2 + JOURNEY_STROKE_WIDTH, lines.length * 22) + JOURNEY_LINE_GAP;
    column.stops.push({ ...stop, lines, span, radius, stopPitch, slot: column.height, height });
    column.height += height + JOURNEY_LINE_GAP;
  });
  const memberPitch = Math.max(JOURNEY_PORTRAIT_SIZE + JOURNEY_LINE_GAP,
    ...connectedRows.map((member) => wrapJourneyLabel(member.name).length * 22 + JOURNEY_LINE_GAP));
  const bundleHeight = Math.max(0, connectedRows.length - 1) * memberPitch;
  const labelPitch = memberPitch;
  const bodyHeight = Math.max(240, Math.max(0, connectedRows.length - 1) * labelPitch + 128,
    bundleHeight + 90, ...columns.map((column) => column.height + 56));
  const height = bodyHeight + headerHeight;
  const rootX = 258;
  const firstColumnX = rootX + JOURNEY_PORTRAIT_SIZE / 2 + 32
    + Math.max(0, connectedRows.length - 1) * pitch
    + Math.max(0, ...columns.flatMap((column) => column.stops.map((stop) => stop.radius)));
  const width = Math.max(firstColumnX + columnCount * 200, availableWidth,
    rootX + unconnectedRows.length * 148 + 24);
  const columnPitch = columnCount > 1 ? (width - firstColumnX - 200) / (columnCount - 1) : 0;
  const stops = columns.flatMap((column, index) => column.stops.map((stop) => ({
    ...stop, x: firstColumnX + index * columnPitch,
    y: headerHeight + (bodyHeight - column.height) / 2 + stop.slot + stop.height / 2,
    column: index,
  })));
  const rootY = headerHeight + bodyHeight / 2;
  const members = connectedRows.map((row, index) => {
    const memberStops = stops.filter((stop) => stop.memberships.some((entry) => entry.memberId === row.id))
      .sort((first, second) => first.column - second.column || first.y - second.y);
    const origin = { x: rootX, y: rootY + (index - (connectedRows.length - 1) / 2) * memberPitch };
    const ports = memberStops.map((stop) => {
      const entryIndex = stop.memberships.findIndex((entry) => entry.memberId === row.id);
      const offsetY = (entryIndex - (stop.memberships.length - 1) / 2) * stop.stopPitch;
      return { x: stop.x - stop.radius,
        y: stop.y + offsetY, bandId: stop.id, column: stop.column };
    });
    const label = { x: rootX - JOURNEY_PORTRAIT_SIZE / 2 - 12, width: 140,
      y: rootY + (index - (connectedRows.length - 1) / 2) * labelPitch };
    return { ...row, points: [origin, ...ports], origin, label, nameLines: wrapJourneyLabel(row.name),
      portrait: { x: origin.x - JOURNEY_PORTRAIT_SIZE / 2,
        y: origin.y - JOURNEY_PORTRAIT_SIZE / 2, size: JOURNEY_PORTRAIT_SIZE } };
  });
  const unconnectedMembers = unconnectedRows.map((row, index) => {
    const centerX = width - 24 - (unconnectedRows.length - index - 0.5) * 148;
    return { ...row, unconnected: true, nameLines: wrapJourneyLabel(row.name),
      origin: { x: centerX, y: 12 + JOURNEY_PORTRAIT_SIZE / 2 },
      label: { x: centerX, y: 34 + JOURNEY_PORTRAIT_SIZE, width: 140 },
      portrait: { x: centerX - JOURNEY_PORTRAIT_SIZE / 2, y: 12, size: JOURNEY_PORTRAIT_SIZE }, points: [] };
  });
  return { width, height,
    rootX, rootY, bundleHeight, stops, members, unconnectedMembers, headerHeight, pitch };
}

export function getJourneyConnections(layout) {
  const pitch = JOURNEY_STROKE_WIDTH + JOURNEY_LINE_GAP;
  const firstLaneStart = layout.rootX + (layout.members[0]?.portrait?.size || 0) / 2 + 12;
  const firstLanes = new Map(layout.members.map((member, index) => ({
    member, index, upward: member.points[1]?.y < member.origin.y,
  })).filter(({ member }) => member.points.length > 1)
    .sort((first, second) => Number(second.upward) - Number(first.upward)
    || (first.upward ? first.index - second.index : second.index - first.index))
    .map(({ member }, index) => [member.id, firstLaneStart + index * pitch]));
  return layout.members.flatMap((member, index) => {
    const targets = member.points.length > 1 ? member.points.slice(1) : [{ x: layout.rootX + 36, y: member.origin.y }];
    return targets.map((target, stopIndex) => {
      const source = stopIndex ? targets[stopIndex - 1] : member.origin;
      const offset = (index + 1) / (layout.members.length + 1) * Math.max(0, target.x - source.x - 24);
      const sameColumn = source.bandId && source.column === target.column;
      const columnEdge = Math.min(...(layout.stops || []).filter((stop) => stop.column === target.column)
        .map((stop) => stop.x - stop.radius));
      const lane = member.points.length === 1 ? (source.x + target.x) / 2
        : !stopIndex ? firstLanes.get(member.id)
        : sameColumn ? Math.max(firstLaneStart, columnEdge - 16 - index * pitch)
        : source.x === target.x ? Math.max(firstLaneStart, target.x - 16 - index * pitch)
        : target.y < source.y ? source.x + 12 + offset : target.x - 12 - offset;
      return { memberId: member.id, name: member.name, color: member.color, source, target, lane,
        points: [source, { x: lane, y: source.y }, { x: lane, y: target.y }, target] };
    });
  });
}

export function roundedJourneyPath(points, radius = 8) {
  const route = createPath();
  if (!points.length) return '';
  route.moveTo(points[0].x, points[0].y);
  points.slice(1, -1).forEach((corner, index) => {
    const previous = points[index];
    const next = points[index + 2];
    const incoming = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outgoing = Math.hypot(next.x - corner.x, next.y - corner.y);
    route.arcTo(corner.x, corner.y, next.x, next.y, Math.min(radius, incoming / 2, outgoing / 2));
  });
  const end = points[points.length - 1];
  route.lineTo(end.x, end.y);
  return route.toString();
}