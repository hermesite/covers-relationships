export function getArtistIdFromUrl(artistOptions) {
  const requestedArtistId = new URLSearchParams(window.location.search).get('artistId');
  const isSupported = artistOptions.some((option) => String(option.id) === requestedArtistId);
  return isSupported ? requestedArtistId : String(artistOptions[0].id);
}

export function setArtistIdInUrl(artistId) {
  const url = new URL(window.location.href);
  url.searchParams.set('artistId', artistId);
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}