import React from 'react';

import { ARTIST_OPTIONS } from '../../constants/artistOptions';
import { getArtistIdFromUrl } from '../artistUrl';
import { BandMemberCards } from '../BandDetail';
import { useBandDetailData } from '../BandDetail/useBandDetailData';
import TransitNetwork from './TransitNetwork';
import './index.css';

function BandFamily() {
  const artistId = getArtistIdFromUrl(ARTIST_OPTIONS);
  const { payload, loading, error } = useBandDetailData(artistId);
  const artist = payload?.artist;
  const relations = Array.isArray(payload?.memberships)
    ? payload.memberships
    : Array.isArray(payload?.relations) ? payload.relations : [];

  return (
    <main className='band-detail-page'>
      <header className='band-detail-header'>
        <div className='container py-4'>
          <p className='band-detail-eyebrow'>Band family</p>
          <h1 className='band-family-title'>{artist?.name || 'Band family'}</h1>
        </div>
      </header>
      <section className='container-fluid band-detail-content' aria-live='polite'>
        {loading && <p>Loading band members...</p>}
        {error && <p className='band-detail-message' role='alert'>{error}</p>}
        {!loading && !error && (
          <TransitNetwork network={payload?.bandFamilyNetwork} artist={artist} relations={relations} details={payload?.memberDetails || []} />
        )}
        {!loading && !error && (
          <BandMemberCards artist={artist} relations={relations} details={payload?.memberDetails || []} />
        )}
        {!loading && !error && relations.length === 0 && (
          <p className='band-detail-message'>No members are recorded for this band.</p>
        )}
      </section>
    </main>
  );
}

export default BandFamily;