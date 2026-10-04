import React, { useState } from 'react';
import { FaCompactDisc, FaTimes } from 'react-icons/fa';

import { ARTIST_OPTIONS } from '../../constants/artistOptions';
import { getArtistIdFromUrl } from '../artistUrl';
import { getMemberTimeline, getReleaseAnnotations, RELEASE_TYPES } from './memberTimeline';
import { useBandDetailData } from './useBandDetailData';
import './index.css';

function externalUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : null;
}

const RELEASE_TYPE_LABELS = { Album: 'Albums', EP: 'EPs', Single: 'Singles' };

function TimelineReleaseAnnotations({ layout, years, selectedYear, onSelect }) {
  if (!layout.groups.length) return null;
  const byYear = new Map(layout.groups.map((group) => [group.year, group]));
  return (
    <>
    <div className='member-release-annotations' aria-label='Releases on the member timeline'>
      {years.map((year) => {
        const group = byYear.get(year);
        if (!group) return <span key={year} />;
        const preview = group.items[0];
        return (
          <button
            className='member-release-annotation'
            type='button'
            key={group.year}
            data-release-year={group.year}
            aria-label={`${group.year}: ${group.items.length} releases; ${preview.title}`}
            aria-expanded={selectedYear === group.year}
            title={`${preview.type}: ${preview.title} (${preview.date}); ${group.items.length} entries in ${group.year}`}
            onClick={() => onSelect(group.year)}
          >
            <FaCompactDisc aria-hidden='true' />
            <span>{group.items.length}</span>
          </button>
        );
      })}
    </div>
      {layout.albumLabels.length > 0 && (
        <div className='member-release-album-labels' style={{ height: layout.height }} aria-label='Album, EP and single titles by release year'>
          <svg viewBox={`0 0 1000 ${layout.height}`} preserveAspectRatio='none' aria-hidden='true'>
            {layout.albumGroups.map((group) => (
              <g key={group.year} data-album-connector-year={group.year}>
                <line x1={group.anchor * 10} y1='0' x2={group.anchor * 10} y2='14' />
                {group.labels.map((album) => <line className='member-release-album-branch' key={album.id} x1={group.anchor * 10} y1='14' x2={album.labelAnchor * 10} y2='28' />)}
              </g>
            ))}
          </svg>
          {layout.albumLabels.map((album) => (
            <button type='button' className='member-release-album-label' key={album.id}
              style={{ left: `${album.left}%`, width: `${album.width}%`, top: album.top, height: album.height }}
              data-album-id={album.id} data-album-year={album.year}
              data-release-label-type={album.type}
              data-release-category={album.secondaryTypes.includes('Compilation') ? 'Compilation' : album.secondaryTypes.includes('Live') ? 'Live' : 'Standard'}
              title={`${album.type}${album.secondaryTypes.length ? ` · ${album.secondaryTypes.join(', ')}` : ''} · ${album.date} · ${album.source || 'MusicBrainz'}`}
              aria-label={`${album.title}, ${album.year}`} aria-pressed={selectedYear === album.year}
              onClick={() => onSelect(album.year)}>
              <span className='member-release-album-title'>{album.title}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export function BandMemberTimeline({ artist, relations, releaseData }) {
  const [selectedPeriod, setSelectedPeriod] = useState(null);
  const [releaseTypes, setReleaseTypes] = useState(RELEASE_TYPES);
  const [releaseCategories, setReleaseCategories] = useState([]);
  const [selectedYear, setSelectedYear] = useState(null);
  const [releaseSearch, setReleaseSearch] = useState('');
  const timeline = getMemberTimeline(artist, relations);
  if (!timeline.rows.length) return null;
  const hasDiscogs = timeline.rows.some((member) => member.periods.some((period) => period.sources.some((source) => source.name === 'Discogs')));
  const releaseItems = Array.isArray(releaseData?.items) ? releaseData.items : [];
  const releaseLayout = getReleaseAnnotations(releaseItems, timeline.startYear, timeline.endYear, releaseTypes, releaseCategories);
  const selectedGroup = releaseLayout.groups.find((group) => group.year === selectedYear);
  const yearStart = selectedGroup ? (selectedYear - timeline.startYear) / timeline.years.length * 100 : null;
  const yearEnd = selectedGroup ? (selectedYear - timeline.startYear + 1) / timeline.years.length * 100 : null;
  const activeMembers = selectedGroup ? timeline.rows.filter((member) => member.periods.some((period) => period.hasDates && period.left < yearEnd && period.left + period.width > yearStart)) : [];
  const matchingReleases = selectedGroup?.items.filter((item) => `${item.title} ${item.type} ${item.date} ${item.disambiguation}`.toLowerCase().includes(releaseSearch.trim().toLowerCase())) || [];

  const yearAxis = (
    <div className='member-timeline-axis' style={{ '--year-count': timeline.years.length }}>
      {timeline.years.map((year) => <span key={year}>{year}</span>)}
    </div>
  );

  return (
    <section className='member-timeline' aria-labelledby='member-timeline-heading'>
      <div className='member-timeline-heading'>
        <h2 id='member-timeline-heading'>Band activity</h2>
        <span>{timeline.startYear} - {timeline.endYear}</span>
      </div>
      <ul className='member-timeline-legend' aria-label='Member roles'>
        {timeline.legend.map((role) => (
          <li key={role.name}>
            <span className='member-role-swatch' style={{ backgroundColor: role.color }} aria-hidden='true' />
            {role.name}
          </li>
        ))}
      </ul>
      {releaseItems.length > 0 && (
        <div className='member-release-filters' role='group' aria-label='Release annotation types'>
          <strong>Releases</strong>
          {RELEASE_TYPES.map((type) => (
            <label key={type}>
              <input type='checkbox' checked={releaseTypes.includes(type)} onChange={(event) => setReleaseTypes(event.target.checked ? [...releaseTypes, type] : releaseTypes.filter((item) => item !== type))} />
              {RELEASE_TYPE_LABELS[type]}
            </label>
          ))}
          {['Live', 'Compilation'].map((category) => (
            <label key={category} className={`member-release-category-filter member-release-category-${category.toLowerCase()}`}>
              <input type='checkbox' checked={releaseCategories.includes(category)} onChange={(event) => setReleaseCategories(event.target.checked ? [...releaseCategories, category] : releaseCategories.filter((item) => item !== category))} />
              {category === 'Live' ? 'Live releases' : 'Compilations'}
            </label>
          ))}
          {releaseData?.source && <a className='member-release-source' href={externalUrl(releaseData.sourceUrl)} target='_blank' rel='noreferrer'>{releaseData.source}{releaseData.officialOnly ? ' · Official editions' : ''}</a>}
        </div>
      )}
      {releaseData?.status === 'unavailable' && <p className='band-detail-message'>Release annotations unavailable: {releaseData.error}</p>}
      {releaseData?.status === 'partial' && <p className='band-detail-message'>Some Discogs entries could not be verified; only verified releases are shown.</p>}
      <div className='member-timeline-scroll' tabIndex={0} role='region' aria-label='Band membership timeline'>
        <div className='member-timeline-chart' style={{ '--year-count': timeline.years.length, minWidth: releaseLayout.minWidth }}>
          <div className='member-timeline-row member-timeline-axis-row'>
            {yearAxis}
          </div>
          <div className='member-timeline-combined'>
          {selectedGroup && <div className='member-release-year-guide' style={{ left: `${yearStart}%`, width: `${100 / timeline.years.length}%` }} aria-hidden='true' />}
          {timeline.rows.map((member) => {
            const periods = member.periods.filter((period) => period.hasDates);
            const nameStart = periods.length ? Math.min(...periods.map((period) => period.left)) : 0;
            return (
            <div className='member-timeline-row' key={member.id} data-member-id={member.id} aria-label={member.name}>
              <div className='member-timeline-track'>
                {periods.map((period, index) => (
                  <button
                    type='button'
                    className={`member-timeline-bar${period.uncertain ? ' member-timeline-bar-uncertain' : ''}`}
                    key={`${period.begin}-${period.end}-${index}`}
                    style={{ left: `${period.left}%`, width: `${period.width}%` }}
                    title={period.label}
                    aria-label={period.label}
                    aria-pressed={selectedPeriod?.label === period.label}
                    data-active-year={selectedGroup ? period.left < yearEnd && period.left + period.width > yearStart : undefined}
                    onClick={() => setSelectedPeriod(period)}
                    onFocus={() => setSelectedPeriod(period)}
                  >
                    {period.roles.map((role) => (
                      <span key={role.name} style={{ backgroundColor: role.color }} />
                    ))}
                  </button>
                ))}
                <span
                  className={`member-timeline-name${nameStart > 80 ? ' member-timeline-name-end' : ''}`}
                  style={{ left: `${nameStart}%` }}
                >
                  {member.name}
                </span>
                {periods.length === 0 && (
                  <span className='member-timeline-undated'>Dates not recorded</span>
                )}
              </div>
            </div>
            );
          })}
          </div>
          <div className='member-timeline-row member-timeline-axis-row' aria-hidden='true'>
            {yearAxis}
          </div>
          <TimelineReleaseAnnotations layout={releaseLayout} years={timeline.years} selectedYear={selectedYear} onSelect={(year) => {
            setSelectedYear(selectedYear === year ? null : year);
            setReleaseSearch('');
          }} />
        </div>
      </div>
      {selectedGroup && (
        <section className='member-release-details' aria-label={`Releases in ${selectedYear}`}>
          <div className='member-release-details-heading'>
            <h3>{selectedYear} releases <span>({selectedGroup.items.length})</span></h3>
            <button type='button' className='member-release-close' title='Close release details' aria-label='Close release details' onClick={() => setSelectedYear(null)}><FaTimes aria-hidden='true' /></button>
          </div>
          <p className='member-release-lineup'><strong>Members in {selectedYear}:</strong> {activeMembers.map((member) => member.name).join(', ') || 'No dated member periods recorded.'}</p>
          <input className='member-release-search' type='search' aria-label='Search releases in selected year' placeholder='Search releases' value={releaseSearch} onChange={(event) => setReleaseSearch(event.target.value)} />
          {matchingReleases.length ? (
            <ul className='member-release-results'>
              {matchingReleases.map((item) => (
                <li key={item.id}>
                  <a href={externalUrl(item.url)} target='_blank' rel='noreferrer'>{item.title}</a>
                  <span>{item.type}{item.secondaryTypes.length ? ` · ${item.secondaryTypes.join(', ')}` : ''} · {item.date}</span>
                  {item.disambiguation && <small>{item.disambiguation}</small>}
                </li>
              ))}
            </ul>
          ) : <p className='member-card-status'>No matching releases.</p>}
        </section>
      )}
      <div className='member-timeline-detail' aria-live='polite'>
        <p>{selectedPeriod?.label || `MusicBrainz${hasDiscogs ? ' + Discogs' : ''} membership dates · ${timeline.rows.length} members`}</p>
        {selectedPeriod && (
          <>
            <nav className='member-source-links' aria-label='Selected membership sources'>
              {selectedPeriod.sources.map((source) => (
                <a key={source.name} href={externalUrl(source.url)} target='_blank' rel='noreferrer'>{source.name}</a>
              ))}
            </nav>
            {selectedPeriod.notes.map((note) => <p className='member-source-note' key={note}>{note}</p>)}
          </>
        )}
      </div>
    </section>
  );
}

function MemberPortrait({ member, detail }) {
  const [failed, setFailed] = useState(false);
  const initials = member.name.split(/\s+/).slice(0, 2).map((word) => word.replace(/[^a-z]/gi, '').charAt(0)).join('');
  return (
    <div className='member-card-portrait'>
      {detail?.imageUrl && !failed ? (
        <img src={detail.imageUrl} alt={member.name} width='96' height='112' loading='lazy' onError={() => setFailed(true)} />
      ) : (
        <div className='member-card-photo-missing' role='img' aria-label={`Photo unavailable for ${member.name}`}>
          <span>{initials}</span>
          <small>Photo unavailable</small>
        </div>
      )}
      {detail?.imageSource && !failed && (
        <a className='member-card-photo-source' href={externalUrl(detail.imageSource.url)} target='_blank' rel='noreferrer'>{detail.imageSource.name}</a>
      )}
    </div>
  );
}

export function BandMemberCards({ artist, relations, details = [] }) {
  const timeline = getMemberTimeline(artist, relations);
  const detailsById = new Map(details.map((detail) => [detail.id, detail]));
  if (!timeline.rows.length) return null;
  return (
    <section className='member-cards-section' aria-labelledby='member-cards-heading'>
      <h2 id='member-cards-heading'>Members <span>({timeline.rows.length})</span></h2>
      <div className='member-cards-grid'>
        {timeline.rows.map((member) => {
          const detail = detailsById.get(member.id);
          const sources = [...new Map(member.periods.flatMap((period) => period.sources).map((source) => [source.name, source])).values()];
          const notes = [...new Set(member.periods.flatMap((period) => period.notes))];
          return (
            <article className='member-card' key={member.id} aria-label={member.name} data-member-id={member.id}>
              <div className='member-card-header'>
                <MemberPortrait member={member} detail={detail} />
                <div className='member-card-identity'>
                  <h3><a href={externalUrl(detail?.discogsUrl || detail?.musicbrainzUrl || member.url)} target='_blank' rel='noreferrer'>{member.name}</a></h3>
                  <ul className='member-card-roles'>
                    {member.roles.map((role) => (
                      <li key={role.name}><span className='member-role-swatch' style={{ backgroundColor: role.color }} aria-hidden='true' />{role.name}</li>
                    ))}
                  </ul>
                  <ul className='member-card-periods' aria-label='Band membership periods'>
                    {member.periods.map((period, index) => (
                      <li key={`${period.begin}-${period.end}-${index}`}>{period.begin || 'Start not recorded'} - {period.end || 'End not recorded'}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className='member-card-bands'>
                <h4>Member of <span>{detail?.memberOfSource === 'Discogs' ? 'Discogs' : 'MusicBrainz fallback'}</span></h4>
                {detail?.memberOfStatus === 'partial' && <p className='member-card-status'>Some Discogs aliases were unavailable; this list may be incomplete.</p>}
                {detail?.memberOf?.length > 0 ? (
                  <ul>
                    {detail.memberOf.map((group, index) => (
                      <li key={`${group.id}-${group.begin}-${group.end}-${index}`}>
                        <a href={externalUrl(group.url)} target='_blank' rel='noreferrer'>{group.name}</a>
                        {(group.begin || group.end) && <span>{group.begin || '?'} - {group.end || (group.ended ? '?' : 'present')}</span>}
                        {group.roles?.length > 0 && <small>{group.roles.join(', ')}</small>}
                        {group.listings?.length > 0 && <small>Listed as {group.listings.map((listing) => listing.name).join(', ')}</small>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className='member-card-status'>
                    {detail?.memberOfStatus === 'complete' ? `No groups recorded in ${detail.memberOfSource || 'MusicBrainz'}.`
                      : detail?.memberOfStatus === 'unavailable' ? 'Membership relationships unavailable.'
                        : detail?.memberOfStatus === 'not-linked' ? 'MusicBrainz identity not confirmed.'
                          : 'MusicBrainz memberships not fetched.'}
                  </p>
                )}
                {detail?.discogsMembershipSources?.length > 0 && (
                  <details className='member-source-details'>
                    <summary>Discogs artist references</summary>
                    <nav className='member-source-links' aria-label={`${member.name} Discogs group references`}>
                      {detail.discogsMembershipSources.map((source) => <a key={source.id} href={externalUrl(source.url)} target='_blank' rel='noreferrer'>{source.name}</a>)}
                    </nav>
                  </details>
                )}
                {detail?.memberOfSource === 'Discogs' && detail?.musicbrainzMemberOf?.length > 0 && (
                  <details className='member-source-details'>
                    <summary>MusicBrainz memberships ({detail.musicbrainzMemberOf.length})</summary>
                    <ul className='member-secondary-groups'>
                      {detail.musicbrainzMemberOf.map((group, index) => <li key={`${group.id}-${index}`}><a href={externalUrl(group.url)} target='_blank' rel='noreferrer'>{group.name}</a>{(group.begin || group.end) && <span> {group.begin || '?'} - {group.end || (group.ended ? '?' : 'present')}</span>}</li>)}
                    </ul>
                  </details>
                )}
              </div>
              {(sources.length > 0 || notes.length > 0) && (
                <details className='member-source-details'>
                  <summary>Membership sources</summary>
                  <nav className='member-source-links' aria-label={`${member.name} membership sources`}>
                    {sources.map((source) => <a key={source.name} href={externalUrl(source.url)} target='_blank' rel='noreferrer'>{source.name}</a>)}
                  </nav>
                  {notes.map((note) => <p className='member-source-note' key={note}>{note}</p>)}
                </details>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function membershipYear(date, fallback) {
  return typeof date === 'string' && /^\d{4}/.test(date) ? date.slice(0, 4) : fallback;
}

function BandMemberGrid({ artist, relations, details = [] }) {
  const timeline = getMemberTimeline(artist, relations);
  const detailsById = new Map(details.map((detail) => [detail.id, detail]));
  if (!timeline.rows.length) return null;

  return (
    <section className='member-compact-section' aria-labelledby='member-compact-heading'>
      <h2 id='member-compact-heading'>Members <span>({timeline.rows.length})</span></h2>
      <div className='member-compact-grid'>
        {timeline.rows.map((member) => (
          <article className='member-compact-card' key={member.id} data-member-id={member.id}>
            <MemberPortrait member={member} detail={detailsById.get(member.id)} />
            <div className='member-compact-identity'>
              <h3>
                <a href={externalUrl(detailsById.get(member.id)?.discogsUrl || detailsById.get(member.id)?.musicbrainzUrl || member.url)} target='_blank' rel='noreferrer'>
                  {member.name}
                </a>
              </h3>
              <p className='member-compact-roles'>{member.roles.map((role) => role.name).join(', ')}</p>
              <ul className='member-compact-years' aria-label='Membership years'>
                {member.periods.map((period, index) => (
                  <li key={`${period.begin}-${period.end}-${index}`}>
                    {membershipYear(period.begin, 'Start unknown')} - {membershipYear(period.end, 'End unknown')}
                  </li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function BandDetail() {
  const selectedArtistId = getArtistIdFromUrl(ARTIST_OPTIONS);
  const { payload, loading, error } = useBandDetailData(selectedArtistId);

  const artist = payload?.artist;
  const relations = Array.isArray(payload?.relations) ? payload.relations : [];
  const memberships = Array.isArray(payload?.memberships) ? payload.memberships : relations;
  const tags = Array.isArray(payload?.tags) ? payload.tags : [];
  const artistFacts = [
    ['Type', artist?.type],
    ['From', artist?.['begin-area']?.name || artist?.area?.name],
    ['Formed', artist?.['life-span']?.begin],
    ['Disbanded', artist?.['life-span']?.end],
    ['Also known as', artist?.aliases?.map((alias) => alias.name).join(', ')],
  ].filter(([, value]) => value);

  return (
    <main className='band-detail-page'>
      <header className='band-detail-header'>
        <div className='container py-4'>
          <div className='band-detail-title-row'>
            <div>
              <p className='band-detail-eyebrow'>MusicBrainz{payload?.membershipEnrichment?.status === 'complete' ? ' + Discogs' : ''} · Membership and tags</p>
              <h1>{artist?.name || 'Band detail'}</h1>
            </div>
          </div>
          {artist && (
            <>
              <dl className='band-member-facts band-detail-artist-facts'>
                {artistFacts.map(([label, value]) => (
                  <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                ))}
              </dl>
              <nav className='band-detail-sources' aria-label='Data sources'>
                <a href={externalUrl(payload.source?.relationshipsUrl)} target='_blank' rel='noreferrer'>MusicBrainz relationships</a>
                <a href={externalUrl(payload.source?.tagsUrl)} target='_blank' rel='noreferrer'>MusicBrainz tags</a>
                {payload.membershipEnrichment?.url && (
                  <a href={externalUrl(payload.membershipEnrichment.url)} target='_blank' rel='noreferrer'>Discogs member profile</a>
                )}
              </nav>
            </>
          )}
        </div>
      </header>

      <section className='container band-detail-content' aria-live='polite'>
        {loading && <p>Loading band members...</p>}
        {error && <p className='band-detail-message' role='alert'>{error}</p>}
        {!loading && !error && payload?.membershipEnrichment?.status === 'unavailable' && (
          <p className='band-detail-message'>Discogs enrichment unavailable: {payload.membershipEnrichment.error}</p>
        )}
        {!loading && !error && <BandMemberTimeline artist={artist} relations={memberships} releaseData={payload?.releaseAnnotations} />}
        {!loading && !error && <BandMemberGrid artist={artist} relations={memberships} details={payload?.memberDetails || []} />}
        {!loading && !error && (
          <section className='band-detail-tags' aria-labelledby='band-tags-heading'>
            <h2 id='band-tags-heading'>Tags</h2>
            {tags.length === 0 ? <p>No tags are recorded for this band.</p> : (
              <ul>
                {tags.map((tag) => (
                  <li key={tag.name}>
                    <a href={`https://musicbrainz.org/tag/${encodeURIComponent(tag.name)}`} target='_blank' rel='noreferrer'>{tag.name}</a>
                    <span aria-label={`${tag.count} votes`}>{tag.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {!loading && !error && memberships.length === 0 && (
          <p className='band-detail-message'>No members are recorded for this band.</p>
        )}
      </section>
    </main>
  );
}

export default BandDetail;