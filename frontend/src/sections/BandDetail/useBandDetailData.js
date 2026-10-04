import { useEffect, useState } from 'react';

import { setArtistIdInUrl } from '../artistUrl';

export function useBandDetailData(artistId) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setArtistIdInUrl(artistId);
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setPayload(null);

    fetch(`/band-detail/${artistId}.json`, { signal: controller.signal })
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
  }, [artistId]);

  return { payload, loading, error };
}