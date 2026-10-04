const ROLE_COLORS = {
  Guitar: '#b34a36',
  Bass: '#276c9e',
  'Drums / percussion': '#b47b12',
  Vocals: '#397c59',
  Keyboards: '#a04678',
  'Role not recorded': '#707a76',
};
const ROLE_ORDER = { Vocals: 0, Guitar: 1, Bass: 2, 'Drums / percussion': 3, Keyboards: 4, 'Role not recorded': 6 };
export const RELEASE_TYPES = ['Album', 'EP', 'Single'];

function memberRoles(attributes = []) {
  const roles = attributes.filter((attribute) => !['original', 'guest', 'additional'].includes(attribute));
  return [...new Set(roles.map((role) => {
    if (/bass/i.test(role)) return 'Bass';
    if (/guitar/i.test(role)) return 'Guitar';
    if (/drum|percussion|membranophone|castanets/i.test(role)) return 'Drums / percussion';
    if (/vocal|singing|voice/i.test(role)) return 'Vocals';
    if (/keyboard|piano|organ/i.test(role)) return 'Keyboards';
    return role;
  }))].map((name) => ({ name, color: ROLE_COLORS[name] || '#596b91' }));
}

function datePosition(value, isEnd = false) {
  if (!value || !/^\d{4}(?:-\d{2})?(?:-\d{2})?$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const yearStart = Date.UTC(year, 0, 1);
  const yearLength = Date.UTC(year + 1, 0, 1) - yearStart;
  const date = month
    ? Date.UTC(year, month - 1, day || 1) + (isEnd && day ? 86400000 : 0)
    : Date.UTC(year + (isEnd ? 1 : 0), 0, 1);
  const boundary = isEnd && month && !day ? Date.UTC(year, month, 1) : date;
  return year + (boundary - yearStart) / yearLength;
}

export function getMemberTimeline(artist, relations) {
  const members = relations.filter((relation) => relation.type === 'member of band'
    && relation.direction === 'backward' && relation.artist?.id);
  const datedYears = members.flatMap((relation) => [relation.begin, relation.end])
    .filter(Boolean).map((date) => Number(date.slice(0, 4))).filter(Number.isFinite);
  const bandStart = datePosition(artist?.['life-span']?.begin);
  const bandEnd = datePosition(artist?.['life-span']?.end, true);
  const startYear = Math.floor(bandStart ?? (datedYears.length ? Math.min(...datedYears) : new Date().getFullYear()));
  const endYear = Math.max(startYear, bandEnd !== null ? Math.ceil(bandEnd) - 1
    : artist?.['life-span']?.ended && datedYears.length ? Math.max(...datedYears) : new Date().getFullYear());
  const rangeEnd = endYear + 1;
  const byMember = new Map();

  members.forEach((relation) => {
    const person = relation.artist;
    if (!byMember.has(person.id)) byMember.set(person.id, {
      id: person.id, name: person.name,
      url: person.url || `https://musicbrainz.org/artist/${person.id}`,
      periods: [], roles: [],
    });
    const member = byMember.get(person.id);
    const roles = memberRoles(relation.attributes);
    if (!roles.length) roles.push({ name: 'Role not recorded', color: ROLE_COLORS['Role not recorded'] });
    roles.forEach((role) => {
      if (!member.roles.some((existing) => existing.name === role.name)) member.roles.push(role);
    });
    const begin = datePosition(relation.begin);
    const end = datePosition(relation.end, true);
    const hasDates = begin !== null || end !== null;
    const start = Math.max(startYear, begin ?? startYear);
    const finish = Math.min(rangeEnd, end ?? rangeEnd);
    member.periods.push({
      begin: relation.begin,
      end: relation.end,
      roles,
      sources: relation.membershipSources || [],
      notes: relation.membershipNotes || [],
      hasDates: hasDates && finish > start,
      uncertain: begin === null || end === null,
      left: (start - startYear) / (rangeEnd - startYear) * 100,
      width: Math.max(0, finish - start) / (rangeEnd - startYear) * 100,
      label: `${person.name}: ${relation.begin || 'Start not recorded'} - ${relation.end || 'End not recorded'}; ${roles.map((role) => role.name).join(', ')}`,
    });
  });

  const rows = [...byMember.values()].sort((first, second) => {
    const roleDifference = Math.min(...first.roles.map((role) => ROLE_ORDER[role.name] ?? 5))
      - Math.min(...second.roles.map((role) => ROLE_ORDER[role.name] ?? 5));
    if (roleDifference) return roleDifference;
    const firstStart = Math.min(...first.periods.filter((period) => period.hasDates).map((period) => period.left));
    const secondStart = Math.min(...second.periods.filter((period) => period.hasDates).map((period) => period.left));
    return firstStart - secondStart || first.name.localeCompare(second.name);
  });
  const legend = [...new Map(rows.flatMap((member) => member.roles).map((role) => [role.name, role])).values()];
  return { startYear, endYear, years: Array.from({ length: rangeEnd - startYear }, (_, index) => startYear + index), rows, legend };
}

export function getReleaseAnnotations(items, startYear, endYear, enabledTypes = RELEASE_TYPES, enabledSecondaryTypes = []) {
  const byYear = new Map();
  const unique = new Map(items.map((item) => [item.id, item]));
  for (const item of unique.values()) {
    if (!Number.isInteger(item.year) || item.year < startYear || item.year > endYear || !RELEASE_TYPES.includes(item.type) || !enabledTypes.includes(item.type)) continue;
    if ((item.secondaryTypes || []).some((type) => ['Live', 'Compilation'].includes(type) && !enabledSecondaryTypes.includes(type))) continue;
    if (!byYear.has(item.year)) byYear.set(item.year, []);
    byYear.get(item.year).push(item);
  }
  const groups = [...byYear.entries()].sort(([first], [second]) => first - second).map(([year, releases]) => {
    releases.sort((first, second) => RELEASE_TYPES.indexOf(first.type) - RELEASE_TYPES.indexOf(second.type)
      || first.secondaryTypes.length - second.secondaryTypes.length
      || first.date.localeCompare(second.date) || first.title.localeCompare(second.title));
    const anchor = (year - startYear + 0.5) / (endYear - startYear + 1) * 100;
    return { year, items: releases, anchor };
  });
  const availableCount = [...unique.values()].filter((item) => Number.isInteger(item.year) && item.year >= startYear && item.year <= endYear && RELEASE_TYPES.includes(item.type)).length;
  const minWidth = Math.max(900, availableCount * 24);
  const spacing = 22 / minWidth * 100;
  const labelWidth = 18 / minWidth * 100;
  const edge = 10 / minWidth * 100;
  const albumLabels = groups.flatMap((group) => {
    return group.items.map((item, index) => ({
      ...item, anchor: group.anchor,
      labelAnchor: group.anchor + (index - (group.items.length - 1) / 2) * spacing,
      width: labelWidth, height: Math.max(100, item.title.length * 8 + 12), top: 30,
    }));
  });
  albumLabels.forEach((label, index) => {
    label.labelAnchor = Math.max(label.labelAnchor, index ? albumLabels[index - 1].labelAnchor + spacing : edge);
  });
  for (let index = albumLabels.length - 1; index >= 0; index -= 1) {
    albumLabels[index].labelAnchor = Math.min(albumLabels[index].labelAnchor, index < albumLabels.length - 1 ? albumLabels[index + 1].labelAnchor - spacing : 100 - edge);
    albumLabels[index].left = albumLabels[index].labelAnchor - labelWidth / 2;
  }
  const albumGroups = groups.map((group) => ({ ...group, labels: albumLabels.filter((label) => label.year === group.year) }))
    .filter((group) => group.labels.length);
  return { groups, albumLabels, albumGroups, minWidth, height: albumLabels.length ? Math.max(...albumLabels.map((label) => label.height)) + 40 : 0 };
}