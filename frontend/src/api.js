import axios from 'axios';

export const SHS_API = 'https://api.secondhandsongs.com';

const api = axios.create({
  baseURL: '/api/secondhandsongs',
  timeout: 20000,
  headers: { Accept: 'application/json' },
});

// The SHS API sends no CORS headers, so absolute URLs are routed through the Vite proxy.
api.interceptors.request.use((config) => {
  const endpoint = new URL(config.url, SHS_API);
  config.url = `${endpoint.pathname}${endpoint.search}`;
  return config;
});

export async function fetchAll(uris) {
  const safeUris = (uris || []).filter(Boolean);
  const responses = await Promise.allSettled(safeUris.map((uri) => api.get(uri)));
  const failed = responses.filter((r) => r.status === 'rejected').length;
  if (failed) console.warn(`SHS API: ${failed}/${safeUris.length} requests failed (likely rate limited or timed out).`);
  return responses.filter((r) => r.status === 'fulfilled').map((r) => r.value.data);
}

export default api;