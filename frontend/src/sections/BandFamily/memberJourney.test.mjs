import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { getMemberJourney, layoutCompactJourney, getJourneyConnections, roundedJourneyPath, wrapJourneyLabel, JOURNEY_STROKE_WIDTH, JOURNEY_LINE_GAP, JOURNEY_PORTRAIT_SIZE, JOURNEY_BAND_RADIUS } from './memberJourney.js';

const relation = (id, name, role) => ({ type: 'member of band', direction: 'backward',
  artist: { id, name }, attributes: [role], begin: '1976', end: '1985' });

test('parallel member rows share a single external band and preserve previous and unknown dates', () => {
  const journey = getMemberJourney({
    artist: { name: 'The Cramps', 'life-span': { begin: '1976', end: '2009', ended: true } },
    relations: [relation('first', 'First member', 'guitar'), relation('second', 'Second member', 'drums')],
    details: [
      { id: 'first', musicbrainzMemberOf: [{ name: 'Earlier Band', begin: '1972', end: '1975' },
        { name: 'Shared Band', begin: '1984' }, { name: 'Unknown Band' }] },
      { id: 'second', memberOf: [{ name: 'Shared Band' }], musicbrainzMemberOf: [{ name: 'SHARED BAND', begin: '1988' }] },
    ],
  });
  assert.equal(journey.rows.length, 2);
  assert.equal(journey.stops.length, 3);
  assert.equal(journey.stops.find((stop) => stop.name === 'Shared Band').memberships.length, 2);
  assert.equal(journey.stops.find((stop) => stop.name === 'Shared Band').year, 1984);
  assert.equal(journey.stops.find((stop) => stop.name === 'Shared Band').lastYear, 1988);
  assert.equal(journey.stops.find((stop) => stop.name === 'Earlier Band').year, 1972);
  assert.ok(journey.startYear < journey.bandStart);
  assert.equal(journey.stops.find((stop) => stop.name === 'Unknown Band').year, null);
  assert.equal(journey.rows.find((row) => row.id === 'first').color, '#b34a36');
  assert.equal(journey.rows.find((row) => row.id === 'second').color, '#b47b12');
});

test('saved Cramps data retains only selected members and deduplicates connected bands', () => {
  const payload = JSON.parse(fs.readFileSync(new URL('../../../data/band-detail/14076.json', import.meta.url), 'utf8'));
  const journey = getMemberJourney({ artist: payload.artist, relations: payload.memberships,
    details: payload.memberDetails, network: payload.bandFamilyNetwork });
  const selectedIds = new Set(payload.bandFamilyNetwork.nodes.filter((node) => node.selectedBandMember)
    .map((node) => node.id.replace(/^artist:/, '')));
  assert.equal(journey.rows.length, selectedIds.size);
  assert.ok(journey.rows.every((row) => selectedIds.has(row.id)));
  assert.equal(journey.stops.length, new Set(journey.stops.map((stop) => stop.id)).size);
  assert.ok(journey.stops.every((stop) => stop.memberships.every((entry) => selectedIds.has(entry.memberId))));
  assert.ok(journey.stops.some((stop) => stop.year !== null));
  assert.ok(journey.stops.some((stop) => stop.year === null));
  assert.ok(journey.rows.some((member) => member.imageUrl));
});

test('Joneses and The Joneses merge without duplicating memberships or losing dates', () => {
  const journey = getMemberJourney({
    artist: { name: 'The Cramps', 'life-span': { begin: '1976', end: '2009', ended: true } },
    relations: [relation('first', 'First', 'guitar'), relation('second', 'Second', 'drums')],
    network: {
      nodes: [{ id: 'band:joneses', type: 'band', name: 'Joneses', url: 'https://example.com/alias' }],
      edges: [{ source: 'artist:first', target: 'band:joneses', begin: '1980' }],
    },
    details: [
      { id: 'first', memberOf: [{ name: 'Joneses' }], musicbrainzMemberOf: [
        { name: 'The Joneses', url: 'https://example.com/canonical', begin: '1984' },
        { name: 'Joneses (2)' },
      ] },
      { id: 'second', memberOf: [{ name: 'The Joneses' }] },
    ],
  });
  const band = journey.stops.find((stop) => stop.id === 'thejoneses');
  assert.equal(band.name, 'The Joneses');
  assert.equal(band.url, 'https://example.com/canonical');
  assert.equal(band.memberships.length, 2);
  assert.equal(band.memberships.find((entry) => entry.memberId === 'first').periods.length, 2);
  assert.equal(band.year, 1980);
  assert.ok(!journey.stops.some((stop) => stop.id === 'joneses'));
  assert.ok(journey.stops.some((stop) => stop.name === 'Joneses (2)'));
  assert.equal(journey.rows.find((member) => member.id === 'first').connectionCount, 2);
  assert.equal(journey.rows.find((member) => member.id === 'second').connectionCount, 1);
  const selectedJoneses = getMemberJourney({
    artist: { name: 'Joneses', 'life-span': { begin: '1980', end: '2009', ended: true } },
    relations: [relation('first', 'First', 'guitar')],
    details: [{ id: 'first', memberOf: [{ name: 'The Joneses' }, { name: 'Joneses' }] }],
  });
  assert.equal(selectedJoneses.stops.length, 0);
});

test('compact layout ignores years, keeps single shared stops and eight-pixel path gaps', () => {
  const payload = JSON.parse(fs.readFileSync(new URL('../../../data/band-detail/14076.json', import.meta.url), 'utf8'));
  const journey = getMemberJourney({ artist: payload.artist, relations: payload.memberships,
    details: payload.memberDetails, network: payload.bandFamilyNetwork });
  const layout = layoutCompactJourney(journey);
  const withoutYears = layoutCompactJourney({ ...journey, startYear: 0, endYear: 9999,
    stops: journey.stops.map((stop) => ({ ...stop, year: null, lastYear: null })) });
  assert.equal(layout.width, withoutYears.width);
  assert.equal(layout.height, withoutYears.height);
  assert.deepEqual(layout.stops.map(({ id, x, y }) => ({ id, x, y })), withoutYears.stops.map(({ id, x, y }) => ({ id, x, y })));
  assert.equal(layout.stops.length, journey.stops.length);
  assert.equal(layout.members.length + layout.unconnectedMembers.length, 24);
  assert.equal(layout.pitch - JOURNEY_STROKE_WIDTH, JOURNEY_LINE_GAP);
  assert.ok(layout.members[1].origin.y - layout.members[0].origin.y >= JOURNEY_PORTRAIT_SIZE + 8);
  assert.ok(layout.height < 2200);
  assert.ok(layout.width < 1500);
});

test('member labels are spaced for readability and band columns use available width', () => {
  const payload = JSON.parse(fs.readFileSync(new URL('../../../data/band-detail/14076.json', import.meta.url), 'utf8'));
  const journey = getMemberJourney({ artist: payload.artist, relations: payload.memberships,
    details: payload.memberDetails, network: payload.bandFamilyNetwork });
  const compact = layoutCompactJourney(journey);
  const wide = layoutCompactJourney(journey, 1440);
  assert.equal(wide.width, 1440);
  assert.equal(wide.members.length + wide.unconnectedMembers.length, 24);
  assert.ok(wide.members.every((member) => member.label.x < member.origin.x));
  assert.ok(wide.members.slice(1).every((member, index) => member.label.y - wide.members[index].label.y >= 18));
  assert.ok(Math.max(...wide.stops.map((stop) => stop.x)) > Math.max(...compact.stops.map((stop) => stop.x)));
  assert.equal(Math.max(...wide.stops.map((stop) => stop.x)), wide.width - 200);
});

test('member axis sorts unique band connections ascending with alphabetical ties', () => {
  const journey = getMemberJourney({
    artist: { name: 'The Cramps', 'life-span': { begin: '1976', end: '2009', ended: true } },
    relations: [relation('high', 'High', 'vocals'), relation('ben', 'Ben', 'guitar'),
      relation('zero', 'Zero', 'drums'), relation('anna', 'Anna', 'bass')],
    details: [
      { id: 'high', memberOf: [{ name: 'First Band' }, { name: 'Second Band' }] },
      { id: 'ben', memberOf: [{ name: 'First Band' }, { name: 'FIRST BAND' }] },
      { id: 'anna', memberOf: [{ name: 'Second Band' }, { name: 'The Cramps' }] },
    ],
  });
  assert.deepEqual(journey.rows.map((member) => [member.name, member.connectionCount]),
    [['Zero', 0], ['Anna', 1], ['Ben', 1], ['High', 2]]);
  assert.deepEqual(journey.rows.map((member) => member.index), [0, 1, 2, 3]);
  const layout = layoutCompactJourney(journey);
  assert.deepEqual(layout.members.map((member) => member.name), ['Anna', 'Ben', 'High']);
  assert.deepEqual(layout.unconnectedMembers.map((member) => member.name), ['Zero']);
  assert.ok(layout.members.slice(1).every((member, index) => member.label.y > layout.members[index].label.y
    && member.origin.y > layout.members[index].origin.y));
  assert.equal(journey.stops.find((stop) => stop.name === 'First Band').row, 2.5);
});

test('member portraits are sourced by identity and fit without overlapping names or each other', () => {
  const journey = getMemberJourney({
    artist: { name: 'The Cramps', 'life-span': { begin: '1976', end: '2009', ended: true } },
    relations: [relation('first', 'First', 'guitar'), relation('second', 'Second', 'drums')],
    details: [{ id: 'first', imageUrl: '/images/members/first.jpg', memberOf: [{ name: 'Shared Band' }] },
      { id: 'second', memberOf: [{ name: 'Shared Band' }] }],
    network: { nodes: [{ id: 'artist:second', type: 'artist', selectedBandMember: true, imageUrl: '/images/members/second.jpg' }] },
  });
  assert.equal(journey.rows.find((member) => member.id === 'first').imageUrl, '/images/members/first.jpg');
  assert.equal(journey.rows.find((member) => member.id === 'second').imageUrl, '/images/members/second.jpg');
  const layout = layoutCompactJourney(journey);
  assert.ok(layout.members.every((member) => member.portrait.x - member.label.x === 12));
  assert.ok(layout.members.every((member) => member.portrait.size === 60
    && member.portrait.x + member.portrait.size / 2 === member.origin.x
    && member.portrait.y + member.portrait.size / 2 === member.origin.y));
  assert.ok(layout.members[0].label.y >= 48);
  assert.ok(layout.members.slice(1).every((member, index) => member.portrait.y >= layout.members[index].portrait.y + layout.members[index].portrait.size));
});

test('Cramps axis places Lux Interior and Poison Ivy immediately before Julien Hechtlinger', () => {
  const input = {
    artist: { name: 'The Cramps', 'life-span': { begin: '1976', end: '2009', ended: true } },
    relations: [relation('julien', 'Julien Hechtlinger', 'guitar'), relation('lux', 'Lux Interior', 'vocals'),
      relation('ivy', 'Poison Ivy', 'guitar'), relation('other', 'Other', 'drums')],
    details: [
      { id: 'julien', memberOf: [{ name: 'Shared Band' }] },
      { id: 'lux', memberOf: [{ name: 'Shared Band' }] },
      { id: 'ivy', memberOf: [{ name: 'Shared Band' }] },
      { id: 'other', memberOf: [{ name: 'Shared Band' }, { name: 'Other Band' }] },
    ],
  };
  const journey = getMemberJourney(input);
  assert.deepEqual(layoutCompactJourney(journey).members.map((member) => member.name),
    ['Lux Interior', 'Poison Ivy', 'Julien Hechtlinger', 'Other']);
  assert.deepEqual(journey.rows.map((member) => member.index), [0, 1, 2, 3]);
  assert.deepEqual(journey.stops.find((stop) => stop.name === 'Shared Band').memberships.map((entry) => entry.memberId),
    ['lux', 'ivy', 'julien', 'other']);
  const otherArtist = getMemberJourney({ ...input, artist: { ...input.artist, name: 'Another Band' } });
  assert.deepEqual(otherArtist.rows.map((member) => member.name),
    ['Julien Hechtlinger', 'Lux Interior', 'Poison Ivy', 'Other']);
});

test('connections pass through band stops in sequence using axis-aligned segments and rounded corners', () => {
  const journey = getMemberJourney({
    artist: { name: 'The Cramps', 'life-span': { begin: '1976', end: '2009', ended: true } },
    relations: [relation('first', 'First', 'guitar')],
    details: [{ id: 'first', memberOf: [{ name: 'First Band' }, { name: 'Second Band' }, { name: 'Third Band' }] }],
  });
  const layout = layoutCompactJourney(journey);
  const connections = getJourneyConnections(layout);
  assert.equal(connections.length, 3);
  assert.equal(connections[0].source, layout.members[0].origin);
  assert.equal(connections[1].source, connections[0].target);
  assert.equal(connections[2].source, connections[1].target);
  assert.ok(connections.every((connection) => connection.points.slice(1).every((point, index) =>
    point.x === connection.points[index].x || point.y === connection.points[index].y)));
  assert.ok(connections.every((connection) => connection.points.every((point) => point.x >= layout.rootX)));
  const path = roundedJourneyPath([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 40 }, { x: 60, y: 40 }]);
  assert.ok(path.includes('A'));
  assert.ok(!path.includes('C'));
  assert.ok(!/NaN|Infinity/.test(roundedJourneyPath([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }])));
});

test('ordered connectors avoid unnecessary crossings by reversing upward and downward lane order', () => {
  const members = [0, 1].map((index) => ({ id: `${index}`, name: `${index}`, color: '#397c59',
    origin: { x: 0, y: 60 + index * 20 }, points: [{ x: 0, y: 60 + index * 20 }, { x: 80, y: index * 20 }] }));
  const upward = getJourneyConnections({ members, rootX: 0 });
  assert.ok(upward[0].lane < upward[1].lane);
  const downward = getJourneyConnections({ members: members.map((member, index) => ({ ...member,
    points: [member.origin, { x: 80, y: 100 + index * 20 }] })), rootX: 0 });
  assert.ok(downward[0].lane > downward[1].lane);
});

test('first-column connector lanes have eight-pixel clearance beyond the portraits', () => {
  const payload = JSON.parse(fs.readFileSync(new URL('../../../data/band-detail/14076.json', import.meta.url), 'utf8'));
  const layout = layoutCompactJourney(getMemberJourney({ artist: payload.artist, relations: payload.memberships,
    details: payload.memberDetails, network: payload.bandFamilyNetwork }));
  const firstConnections = getJourneyConnections(layout).filter((connection) => connection.target.bandId && connection.source ===
    layout.members.find((member) => member.id === connection.memberId).origin);
  const lanes = firstConnections.map((connection) => connection.lane).sort((first, second) => first - second);
  assert.ok(lanes.slice(1).every((lane, index) => lane - lanes[index] - JOURNEY_STROKE_WIDTH === JOURNEY_LINE_GAP));
  assert.ok(lanes[0] >= layout.rootX + JOURNEY_PORTRAIT_SIZE / 2 + 12);
  assert.ok(lanes.at(-1) + 16 <= Math.min(...layout.stops.map((stop) => stop.x)));
  assert.ok(Math.min(...layout.stops.map((stop) => stop.x)) - layout.rootX - JOURNEY_PORTRAIT_SIZE / 2 > 200);
  const disconnected = getJourneyConnections(layout).filter((connection) => !connection.target.bandId);
  assert.ok(disconnected.every((connection) => connection.points.every((point) => point.x <= connection.target.x)));
});

test('unconnected members sit in a top-right row outside the axis and names wrap', () => {
  const payload = JSON.parse(fs.readFileSync(new URL('../../../data/band-detail/14076.json', import.meta.url), 'utf8'));
  const layout = layoutCompactJourney(getMemberJourney({ artist: payload.artist, relations: payload.memberships,
    details: payload.memberDetails, network: payload.bandFamilyNetwork }));
  assert.equal(layout.members.length, 20);
  assert.equal(layout.unconnectedMembers.length, 4);
  assert.ok(layout.members.every((member) => member.connectionCount > 0));
  assert.ok(layout.unconnectedMembers.every((member) => member.connectionCount === 0
    && member.origin.y === 12 + JOURNEY_PORTRAIT_SIZE / 2 && member.portrait.size === 60));
  assert.ok(layout.unconnectedMembers.slice(1).every((member, index) => member.origin.x > layout.unconnectedMembers[index].origin.x));
  assert.ok(layout.unconnectedMembers.every((member) => member.origin.x > layout.rootX && member.label.y < layout.headerHeight));
  assert.equal(getJourneyConnections(layout).some((connection) => !connection.target.bandId), false);
  assert.deepEqual(wrapJourneyLabel('Nickey Beat Alexander'), ['Nickey Beat', 'Alexander']);
  assert.ok(wrapJourneyLabel('A'.repeat(40)).every((line) => line.length <= 18));
});

test('shared bands have fixed-size member stops with eight-pixel gaps and aligned connections', () => {
  const payload = JSON.parse(fs.readFileSync(new URL('../../../data/band-detail/14076.json', import.meta.url), 'utf8'));
  const layout = layoutCompactJourney(getMemberJourney({ artist: payload.artist, relations: payload.memberships,
    details: payload.memberDetails, network: payload.bandFamilyNetwork }));
  assert.ok(layout.stops.every((stop) => stop.radius === JOURNEY_BAND_RADIUS));
  assert.ok(layout.stops.some((stop) => stop.memberships.length > 1));
  layout.stops.forEach((stop) => {
    assert.equal(stop.stopPitch - stop.radius * 2 - JOURNEY_STROKE_WIDTH, JOURNEY_LINE_GAP);
    stop.memberships.forEach((entry, index) => {
      const member = layout.members.find((row) => row.id === entry.memberId);
      const port = member.points.find((point) => point.bandId === stop.id);
      assert.equal(port.x, stop.x - JOURNEY_BAND_RADIUS);
      assert.equal(port.y, stop.y + (index - (stop.memberships.length - 1) / 2) * stop.stopPitch);
    });
  });
});