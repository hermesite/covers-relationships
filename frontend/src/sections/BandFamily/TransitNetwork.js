import React, { useMemo, useRef, useState } from 'react';
import { FaExpand, FaMinus, FaPlus, FaSearch, FaTimes } from 'react-icons/fa';
import D3TubeMap from './D3TubeMap';
import { getMemberJourney } from './memberJourney';

export default function TransitNetwork({ network, artist, relations, details }) {
  const controlsRef = useRef(null);
  const [query, setQuery] = useState('');
  const [selectedBandId, setSelectedBandId] = useState(null);
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const journey = useMemo(() => getMemberJourney({ network, artist, relations, details }),
    [network, artist, relations, details]);
  const matchingBands = journey.stops.filter((stop) => stop.name.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedBand = journey.stops.find((stop) => stop.id === selectedBandId);
  const selectedMember = journey.rows.find((row) => row.id === selectedMemberId);
  const selectBand = (id) => {
    setSelectedMemberId(null);
    setSelectedBandId((current) => current === id ? null : id);
  };
  const selectMember = (id) => {
    setSelectedBandId(null);
    setSelectedMemberId((current) => current === id ? null : id);
  };
  if (!journey.rows.length) return null;

  return (
    <section className='band-family-map' aria-labelledby='band-family-map-heading'>
      <header className='band-family-map-heading'>
        <div>
          <h2 id='band-family-map-heading'>Member journeys</h2>
          <p>{journey.rows.length} members · {journey.stops.length} connected bands</p>
        </div>
        {network?.status === 'partial' && <span className='band-family-map-status' role='status'>Some memberships could not be loaded.</span>}
        <div className='band-family-map-controls' role='group' aria-label='Graph zoom controls'>
          <button type='button' title='Zoom in' aria-label='Zoom in' onClick={() => controlsRef.current?.zoomBy(1.25)}><FaPlus aria-hidden='true' /></button>
          <button type='button' title='Zoom out' aria-label='Zoom out' onClick={() => controlsRef.current?.zoomBy(0.8)}><FaMinus aria-hidden='true' /></button>
          <button type='button' title='Fit graph' aria-label='Fit graph' onClick={() => { setSelectedBandId(null); setSelectedMemberId(null); controlsRef.current?.fit(); }}><FaExpand aria-hidden='true' /></button>
        </div>
      </header>
      <ul className='band-family-map-legend' aria-label='Member roles'>
        {journey.legend.map((role) => <li key={role.name}><span className='member-role-swatch' style={{ backgroundColor: role.color }} aria-hidden='true' />{role.name}</li>)}
      </ul>
      <details className='band-family-routes'>
        <summary>Connected bands ({journey.stops.length})</summary>
        <label className='band-family-route-search'>
          <FaSearch aria-hidden='true' />
          <input type='search' placeholder='Find a band' aria-label='Find a band' value={query} onChange={(event) => setQuery(event.target.value)} />
          {query && <button type='button' aria-label='Clear band search' onClick={() => setQuery('')}><FaTimes aria-hidden='true' /></button>}
        </label>
        <div className='band-family-route-list'>
          {matchingBands.map((band) => <button type='button' key={band.id} className={selectedBandId === band.id ? 'is-selected' : ''}
            aria-pressed={selectedBandId === band.id} onClick={() => selectBand(band.id)}>
            <span style={{ backgroundColor: band.memberships[0].color }} aria-hidden='true' />
            <span>{band.name}</span><small>{band.memberships.length}</small>
          </button>)}
          {!matchingBands.length && <p className='band-family-search-empty'>No matching bands.</p>}
        </div>
      </details>
      <div className='band-family-map-canvas band-family-journey-canvas' aria-label='Compact member connection graph'>
        <D3TubeMap journey={journey} selectedBandId={selectedBandId} selectedMemberId={selectedMemberId}
          onSelectBand={selectBand} onSelectMember={selectMember} controlsRef={controlsRef} />
      </div>
      <div className='band-family-map-selection' aria-live='polite'>
        {selectedBand && <><h3>{selectedBand.name}</h3><p>{selectedBand.memberships.map((entry) => {
          const member = journey.rows.find((row) => row.id === entry.memberId);
          return member.name;
        }).join(' · ')}</p></>}
        {selectedMember && <><h3>{selectedMember.name}</h3><p>{selectedMember.roles.map((role) => role.name).join(', ')}</p>
          <p>{journey.stops.filter((stop) => stop.memberships.some((entry) => entry.memberId === selectedMember.id)).map((stop) => stop.name).join(' · ')}</p></>}
      </div>
    </section>
  );
}