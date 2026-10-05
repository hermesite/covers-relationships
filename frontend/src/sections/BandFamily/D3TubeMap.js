import * as d3 from 'd3';
import React, { useEffect, useRef, useState } from 'react';
import { layoutCompactJourney, getJourneyConnections, roundedJourneyPath, JOURNEY_STROKE_WIDTH, JOURNEY_PORTRAIT_SIZE } from './memberJourney';

export default function D3TubeMap({ journey, selectedBandId, selectedMemberId, onSelectBand, onSelectMember, controlsRef }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const callbacksRef = useRef({});
  const [scale, setScale] = useState(1);
  const [availableWidth, setAvailableWidth] = useState(0);
  callbacksRef.current = { onSelectBand, onSelectMember };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const updateWidth = () => setAvailableWidth(Math.floor(container.clientWidth));
    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);
    updateWidth();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const layout = layoutCompactJourney(journey, availableWidth);
    const svg = d3.select(container).append('svg').attr('class', 'band-family-journey-svg')
      .attr('width', layout.width).attr('height', layout.height).attr('viewBox', `0 0 ${layout.width} ${layout.height}`)
      .attr('role', 'img').attr('aria-label', `${journey.bandName} members and connected bands`);
    svgRef.current = svg;
    const paths = getJourneyConnections(layout);
    svg.append('g').attr('class', 'journey-paths').selectAll('path').data(paths).join('path')
      .attr('class', 'journey-path').attr('d', (entry) => roundedJourneyPath(entry.points)).attr('fill', 'none').attr('stroke', (entry) => entry.color)
      .attr('stroke-width', JOURNEY_STROKE_WIDTH).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round')
      .attr('tabindex', 0).attr('role', 'button').attr('aria-label', (entry) => `Highlight ${entry.name}`)
      .on('click', (event, entry) => callbacksRef.current.onSelectMember?.(entry.memberId))
      .on('keydown', (event, entry) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); callbacksRef.current.onSelectMember?.(entry.memberId); }
      }).append('title').text((entry) => entry.name);
    const members = svg.append('g').attr('class', 'journey-member-labels').selectAll('g')
      .data([...layout.members, ...layout.unconnectedMembers]).join('g')
      .attr('class', (member) => member.unconnected ? 'journey-unconnected-member' : 'journey-axis-member')
      .attr('data-member-id', (member) => member.id);
    members.filter((member) => !member.unconnected).append('path').attr('class', 'journey-member-leader')
      .attr('d', (member, index) => {
        const source = { x: member.label.x + 10, y: member.label.y };
        const distance = Math.abs(index - (layout.members.length - 1) / 2) / Math.max(1, (layout.members.length - 1) / 2);
        const lane = source.x + 6 + distance * (member.origin.x - source.x - 12);
        return roundedJourneyPath([source, { x: lane, y: source.y }, { x: lane, y: member.origin.y }, member.origin]);
      })
      .attr('fill', 'none').attr('stroke', (member) => member.color).attr('stroke-width', JOURNEY_STROKE_WIDTH);
    const portraits = members.append('g').attr('class', 'journey-member-portrait')
      .attr('transform', (member) => `translate(${member.portrait.x},${member.portrait.y})`)
      .attr('tabindex', 0).attr('role', 'button').attr('aria-label', (member) => `Highlight ${member.name}`)
      .on('click', (event, member) => callbacksRef.current.onSelectMember?.(member.id))
      .on('keydown', (event, member) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); callbacksRef.current.onSelectMember?.(member.id); }
      });
    portraits.append('circle').attr('cx', (member) => member.portrait.size / 2).attr('cy', (member) => member.portrait.size / 2)
      .attr('r', (member) => member.portrait.size / 2).attr('fill', '#e8eeea');
    portraits.append('text').attr('class', 'journey-member-initials')
      .attr('x', (member) => member.portrait.size / 2).attr('y', (member) => member.portrait.size / 2)
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle').attr('fill', (member) => member.color)
      .text((member) => member.name.split(/\s+/).map((word) => word[0]).slice(0, 2).join(''));
    portraits.filter((member) => member.imageUrl).append('image')
      .attr('href', (member) => member.imageUrl).attr('width', (member) => member.portrait.size)
      .attr('height', (member) => member.portrait.size).attr('preserveAspectRatio', 'xMidYMid slice')
      .on('error', function () { d3.select(this).remove(); });
    portraits.append('circle').attr('class', 'journey-member-portrait-outline')
      .attr('cx', (member) => member.portrait.size / 2).attr('cy', (member) => member.portrait.size / 2)
      .attr('r', (member) => (member.portrait.size - JOURNEY_STROKE_WIDTH) / 2)
      .attr('fill', 'none').attr('stroke', (member) => member.color).attr('stroke-width', JOURNEY_STROKE_WIDTH);
    portraits.append('title').text((member) => member.imageUrl ? member.name : `${member.name}: photo unavailable`);
    members.append('text').attr('class', 'journey-member-name')
      .attr('x', (member) => member.label.x).attr('y', (member) => member.label.y)
      .attr('text-anchor', (member) => member.unconnected ? 'middle' : 'end').attr('dominant-baseline', 'middle')
      .each(function (member) {
        d3.select(this).selectAll('tspan').data(member.nameLines).join('tspan')
          .attr('x', member.label.x)
          .attr('dy', (line, index) => index ? 22 : member.unconnected ? 0 : -(member.nameLines.length - 1) * 11)
          .text((line) => line)
          .each(function () {
            if (this.getComputedTextLength() > member.label.width) {
              d3.select(this).attr('textLength', member.label.width).attr('lengthAdjust', 'spacingAndGlyphs');
            }
          });
      })
      .attr('tabindex', 0).attr('role', 'button').attr('aria-label', (member) => `Highlight ${member.name}`)
      .on('click', (event, member) => callbacksRef.current.onSelectMember?.(member.id))
      .on('keydown', (event, member) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); callbacksRef.current.onSelectMember?.(member.id); }
      });
    if (layout.members.length) svg.append('line').attr('class', 'journey-root-stop')
      .attr('x1', layout.rootX).attr('x2', layout.rootX)
      .attr('y1', layout.rootY - layout.bundleHeight / 2).attr('y2', layout.rootY + layout.bundleHeight / 2)
      .attr('stroke', '#344a4d').attr('stroke-width', JOURNEY_STROKE_WIDTH).attr('stroke-linecap', 'round').lower();
    svg.append('text').attr('class', 'journey-root-label')
      .attr('x', layout.rootX + (layout.members[0]?.portrait.size ?? JOURNEY_PORTRAIT_SIZE) / 2)
      .attr('y', (layout.members[0]?.portrait.y ?? layout.rootY) - 12).attr('text-anchor', 'end').text(journey.bandName);
    const bands = svg.append('g').attr('class', 'journey-bands').selectAll('g').data(layout.stops).join('g')
      .attr('class', 'journey-band-node').attr('data-band-id', (stop) => stop.id)
      .attr('transform', (stop) => `translate(${stop.x},${stop.y})`)
      .attr('tabindex', 0).attr('role', 'button').attr('aria-label', (stop) => `Highlight ${stop.name}`)
      .on('click', (event, stop) => callbacksRef.current.onSelectBand?.(stop.id))
      .on('keydown', (event, stop) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); callbacksRef.current.onSelectBand?.(stop.id); }
      });
    bands.filter((stop) => stop.memberships.length > 1).append('line').attr('class', 'journey-band-transfer')
      .attr('x1', 0).attr('x2', 0).attr('y1', (stop) => -stop.span / 2).attr('y2', (stop) => stop.span / 2)
      .attr('stroke', '#344a4d').attr('stroke-width', JOURNEY_STROKE_WIDTH).attr('stroke-linecap', 'round');
    bands.each(function (stop) {
      d3.select(this).selectAll('circle.journey-band-stop').data(stop.memberships.map((entry, index) => ({
        ...entry, offsetY: (index - (stop.memberships.length - 1) / 2) * stop.stopPitch,
      }))).join('circle').attr('class', 'journey-band-stop').attr('data-member-id', (entry) => entry.memberId)
        .attr('cx', 0).attr('cy', (entry) => entry.offsetY).attr('r', stop.radius)
        .attr('fill', '#fff').attr('stroke', '#344a4d').attr('stroke-width', JOURNEY_STROKE_WIDTH)
        .append('title').text((entry) => journey.rows.find((member) => member.id === entry.memberId)?.name || '');
    });
    bands.append('text').attr('x', (stop) => stop.radius + 10).attr('y', 0).attr('dominant-baseline', 'middle').each(function (stop) {
      d3.select(this).selectAll('tspan').data(stop.lines).join('tspan')
        .attr('x', stop.radius + 10).attr('dy', (line, index) => index ? 22 : -(stop.lines.length - 1) * 11).text((line) => line);
    });
    bands.append('title').text((stop) => `${stop.name}\n${stop.memberships.map((entry) => journey.rows.find((member) => member.id === entry.memberId).name).join(', ')}`);
    const fit = () => {
      setScale(1);
      container.scrollTo({ left: 0, top: 0 });
    };
    controlsRef.current = {
      zoomBy: (factor) => setScale((current) => Math.max(0.65, Math.min(2.5, current * factor))),
      fit,
      focusBand: (id) => {
        const stop = layout.stops.find((entry) => entry.id === id);
        const renderedScale = Number(svg.attr('width')) / layout.width;
        if (stop) container.scrollTo({ left: Math.max(0, stop.x * renderedScale - container.clientWidth / 2),
          top: Math.max(0, stop.y * renderedScale - container.clientHeight / 2) });
      },
    };
    fit();
    return () => { svg.remove(); svgRef.current = null; controlsRef.current = null; };
  }, [journey, controlsRef, availableWidth]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const band = journey.stops.find((stop) => stop.id === selectedBandId);
    const activeMembers = selectedMemberId ? new Set([selectedMemberId])
      : band ? new Set(band.memberships.map((entry) => entry.memberId)) : new Set();
    svg.selectAll('.journey-path').attr('opacity', (entry) => !activeMembers.size || activeMembers.has(entry.memberId) ? 0.9 : 0.08);
    svg.selectAll('.journey-member-labels > g').attr('opacity', (member) => !activeMembers.size || activeMembers.has(member.id) ? 1 : 0.2);
    svg.selectAll('.journey-band-node')
      .attr('opacity', (stop) => !activeMembers.size || stop.memberships.some((entry) => activeMembers.has(entry.memberId)) ? 1 : 0.2)
      .classed('is-selected', (stop) => stop.id === selectedBandId);
    if (selectedBandId) controlsRef.current?.focusBand(selectedBandId);
  }, [journey, selectedBandId, selectedMemberId, controlsRef, availableWidth]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const box = svg.attr('viewBox').split(' ').map(Number);
    svg.attr('width', box[2] * scale).attr('height', box[3] * scale);
  }, [journey, scale, availableWidth]);

  return <div ref={containerRef} className='band-family-journey-scroll' tabIndex={0} role='region' aria-label='Scrollable band connection graph' />;
}