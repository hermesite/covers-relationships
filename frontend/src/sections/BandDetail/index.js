import React, { useEffect, useState } from 'react';

import { ARTIST_OPTIONS } from '../../constants/artistOptions';
import { getArtistIdFromUrl, setArtistIdInUrl } from '../artistUrl';
import './index.css';

function BandDetail() {
  const [selectedArtistId, setSelectedArtistId] = useState(() => getArtistIdFromUrl(ARTIST_OPTIONS));
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setArtistIdInUrl(selectedArtistId);
  }, [selectedArtistId]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setPayload(null);

    fetch(`/band-detail/${selectedArtistId}.json`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
          throw new Error('Band details not found. Generate them with the band-detail data script.');
        }
        return response.json();
      })
      .then((data) => {
        setPayload(data);
        setLoading(false);
      })
      .catch((fetchError) => {
        if (fetchError.name === 'AbortError') return;
        setError(fetchError.message || 'Failed to load band details.');
        setLoading(false);
      });

    return () => controller.abort();
  }, [selectedArtistId]);

  const artist = payload?.artist;
  const relations = Array.isArray(payload?.relations) ? payload.relations : [];

  return (
    <main className='band-detail-page'>
      <header className='band-detail-header'>
        <div className='container py-4'>
          <div className='band-detail-toolbar'>
            <label htmlFor='band-detail-artist-select'>Band</label>
            <select
              id='band-detail-artist-select'
              value={selectedArtistId}
              onChange={(event) => setSelectedArtistId(event.target.value)}
              disabled={loading}
            >
              {ARTIST_OPTIONS.map((option) => (
                <option key={option.id} value={String(option.id)}>{option.name}</option>
              ))}
            </select>
          </div>

          <div className='band-detail-title-row'>
            <div>
              <p className='band-detail-eyebrow'>Artist relationships</p>
              <h1>{artist?.commonName || 'Band detail'}</h1>
            </div>
            {!loading && !error && (
              <p className='band-detail-count'>{relations.length} relation{relations.length === 1 ? '' : 's'}</p>
            )}
          </div>
        </div>
      </header>

      <section className='container band-detail-content' aria-live='polite'>
        {loading && <p>Loading band relations...</p>}
        {error && <p className='band-detail-message' role='alert'>{error}</p>}
        {!loading && !error && relations.length === 0 && (
          <p className='band-detail-message'>No relations are recorded for this band.</p>
        )}
        {!loading && !error && relations.length > 0 && (
          <div className='band-detail-list'>
            {relations.map((relation, index) => {
              const person = relation.artistDetails || relation.artist || {};
              const facts = [
                ['Birth name', person.birthName],
                ['Legal name', person.legalName],
                ['Born', person.birthDate],
                ['Died', person.deathDate],
                ['Country', person.homeCountry],
                ['Also known as', Array.isArray(person.aliases) ? person.aliases.join(', ') : null],
              ].filter(([, value]) => typeof value === 'string' && value.trim());

              return (
                <article className='band-member' key={`${person.uri || person.commonName || 'relation'}-${index}`}>
                  <div className='band-member-heading'>
                    <div>
                      <p className='band-member-relation'>{relation.relationName || 'Related artist'}</p>
                      <h2>{person.commonName || 'Unknown artist'}</h2>
                    </div>
                    <span className='band-member-type'>
                      {person.entitySubType || relation.artist?.entitySubType || 'artist'}
                    </span>
                  </div>
                  {relation.comments && <p className='band-member-credit'>{relation.comments}</p>}
                  {facts.length > 0 && (
                    <dl className='band-member-facts'>
                      {facts.map(([label, value]) => (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {relation.artistDetailsError && (
                    <p className='band-member-error'>Extended details could not be loaded.</p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

export default BandDetail;