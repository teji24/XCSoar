// Appels à l'API PHP.

async function request(method, url, body, raw = false) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (!res.ok) {
    let message = `Erreur ${res.status}`;
    try {
      message = (await res.json()).error || message;
    } catch { /* réponse non JSON */ }
    throw new Error(message);
  }
  return raw ? res : res.json();
}

export const api = {
  config: () => request('GET', '/api/config'),
  projects: () => request('GET', '/api/projects'),
  createProject: (name) => request('POST', '/api/projects', { name }),
  project: (id) => request('GET', `/api/projects/${id}`),
  saveProject: (id, doc) => request('PUT', `/api/projects/${id}`, doc),
  deleteProject: (id) => request('DELETE', `/api/projects/${id}`),
  uploadPhoto: (id, file) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('lastModified', String(file.lastModified || Date.now()));
    return request('POST', `/api/projects/${id}/photos`, fd);
  },
  updatePhoto: (id, photoId, changes) => request('PATCH', `/api/projects/${id}/photos/${photoId}`, changes),
  deletePhoto: (id, photoId) => request('DELETE', `/api/projects/${id}/photos/${photoId}`),
  previewUrl: (id, photoId) => `/api/projects/${id}/photos/${photoId}/preview`,
  mapUrl: (id, pageId, version) => `/api/projects/${id}/pages/${pageId}/map?v=${version}`,
  geocode: (lat, lon) => request('GET', `/api/geocode?lat=${lat}&lon=${lon}`),
  pdf: (id) => request('POST', `/api/projects/${id}/pdf`, {}, true),
  immichAlbums: () => request('GET', '/api/immich/albums'),
  immichAlbum: (albumId) => request('GET', `/api/immich/albums/${albumId}`),
  immichThumb: (assetId) => `/api/immich/thumb/${assetId}`,
  immichImport: (id, assetId) => request('POST', `/api/projects/${id}/immich`, { assetId }),
};
