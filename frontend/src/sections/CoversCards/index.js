import React, { useEffect, useState } from 'react';

import { ARTIST_OPTIONS } from '../../constants/artistOptions';
import { getArtistIdFromUrl, setArtistIdInUrl } from '../artistUrl';

function CoversCards() {
  const [selectedArtistId, setSelectedArtistId] = useState(() => getArtistIdFromUrl(ARTIST_OPTIONS));
  const [payload, setPayload] = useState(null);
  const [imageUrls, setImageUrls] = useState([]);
  const [failedImages, setFailedImages] = useState([]);
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
    setImageUrls([]);
    setFailedImages([]);

    fetch(`/graphs/covers/${selectedArtistId}.json`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
          throw new Error('Generated data file not found. Run the Python data generator first.');
        }
        return response.json();
      })
      .then((data) => {
        setPayload(data);
        setImageUrls([...new Set([
          ...(Array.isArray(data.artistPictures) ? data.artistPictures : []),
          data.artistPictureResolved || data.artistPicture || data.artist?.picture,
        ].filter(Boolean))]);
        setError(data.error || null);
        setLoading(false);
      })
      .catch((fetchError) => {
        if (fetchError.name === 'AbortError') return;
        setError(fetchError.message || 'Failed to load cover data.');
        setLoading(false);
      });

    return () => controller.abort();
  }, [selectedArtistId]);

  const nodes = (payload?.networkData || []).filter((item) => item?.data?.id);
  const nodesById = new Map(nodes.map((item) => [item.data.id, item.data]));
  const cardsById = new Map();

  (payload?.networkData || []).forEach((item) => {
    const source = nodesById.get(item?.data?.source);
    const artist = nodesById.get(item?.data?.target);
    if (!source || !artist || artist.nodeType !== 'artist') return;
    if (!cardsById.has(artist.id)) cardsById.set(artist.id, { artist, originals: new Map() });
    cardsById.get(artist.id).originals.set(source.id, source.label);
  });

  const cards = [...cardsById.values()].sort((first, second) =>
    first.artist.label.localeCompare(second.artist.label)
  );

  return (
    <main className='section-covers-cards'>
      <header className='covers-cards-header'>
        <div className='container py-4'>
          <div className='graph-toolbar'>
            <label htmlFor='covers-cards-artist-select'>Artist</label>
            <select
              id='covers-cards-artist-select'
              value={selectedArtistId}
              onChange={(event) => setSelectedArtistId(event.target.value)}
            >
              {ARTIST_OPTIONS.map((option) => (
                <option key={option.id} value={String(option.id)}>{option.name}</option>
              ))}
            </select>
          </div>

          {!loading && !error && payload?.artist && (
            <div className='artist-summary mt-4'>
              {imageUrls.length > 0 && (
                <div className='artist-image-mosaic'>
                  {imageUrls.map((imageUrl, index) => (
                    <img
                      key={imageUrl}
                      src={imageUrl}
                      alt={`${payload.artist.commonName} ${index + 1}`}
                      onError={() => setImageUrls((urls) => urls.filter((url) => url !== imageUrl))}
                    />
                  ))}
                </div>
              )}
              <div>
                <h1 className='mb-1'>{payload.artist.commonName}</h1>
                <p className='mb-0'>{payload.coversCount || 0} covers{payload.partialData ? ' (partial data)' : ''}</p>
              </div>
            </div>
          )}
        </div>
      </header>

      <section className='container py-4' aria-label='Original performers'>
        {loading && <p>Loading cover data...</p>}
        {error && <p role='alert'>Unable to display cover cards: {error}</p>}
        {!loading && !error && cards.length === 0 && <p>No cover data available for this artist.</p>}
        {!loading && !error && cards.length > 0 && (
          <div className='row row-cols-1 row-cols-sm-2 row-cols-lg-3 row-cols-xl-4 g-4'>
            {cards.map(({ artist, originals }) => (
              <div className='col' key={artist.id}>
                <article className='card h-100 covers-artist-card'>
                  {artist.imageUrl && !failedImages.includes(artist.id) ? (
                    <img
                      src={artist.imageUrl}
                      className='card-img-top'
                      alt={artist.label}
                      loading='lazy'
                      onError={() => setFailedImages((ids) => [...ids, artist.id])}
                    />
                  ) : (
                    <div className='covers-card-image-placeholder' aria-hidden='true' />
                  )}
                  <div className='card-body'>
                    <h2 className='card-title h5 mb-0'>{artist.label}</h2>
                  </div>
                  <ul className='list-group list-group-flush' aria-label={`Originals covered by ${payload.artist.commonName}`}>
                    {[...originals.entries()].map(([id, title]) => (
                      <li className='list-group-item' key={id}>{title}</li>
                    ))}
                  </ul>
                </article>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

export default CoversCards;