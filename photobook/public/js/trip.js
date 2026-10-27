// Calcul des étapes du voyage à partir des photos et des réglages du projet.
import { prepare, buildHierarchy, cut, suggestK, summarize, positionsById } from './clustering.js';
import { api } from './api.js';
import { state, photosSorted, markDirty } from './state.js';

export function tripSettings() {
  const t = state.project.trip || (state.project.trip = {});
  t.distanceKm ??= 20;
  t.gapHours ??= 48;
  t.steps ??= 0; // 0 = nombre suggéré
  if (!t.cameraOffsets || Array.isArray(t.cameraOffsets)) t.cameraOffsets = {};
  if (!t.titles || Array.isArray(t.titles)) t.titles = {};
  if (!t.placeNames || Array.isArray(t.placeNames)) t.placeNames = {};
  return t;
}

/** Recalcule la hiérarchie (à appeler quand les photos ou les réglages D/T changent). */
export function computeTrip() {
  const t = tripSettings();
  const items = prepare(photosSorted(), t.cameraOffsets);
  const hierarchy = buildHierarchy(items, { distanceKm: Number(t.distanceKm), gapHours: Number(t.gapHours) });
  state.trip = { items, hierarchy, positions: positionsById(items), suggested: suggestK(hierarchy) };
  return state.trip;
}

export const placeKey = (lat, lon) => `${lat.toFixed(2)},${lon.toFixed(2)}`;

/** Applique le nombre d'étapes courant et met à jour project.clusters. */
export function applySteps() {
  const t = tripSettings();
  if (!state.trip) computeTrip();
  const { items, hierarchy, suggested } = state.trip;
  const k = t.steps > 0 ? Math.min(t.steps, hierarchy.n) : suggested;
  const groups = summarize(cut(hierarchy, k), items, state.photos);
  state.project.clusters = groups.map((g, i) => ({
    id: g.id,
    title: clusterTitle(g, i),
    photoIds: g.photoIds,
    lat: g.lat,
    lon: g.lon,
    start: g.start,
    end: g.end,
    city: g.city,
  }));
  markDirty();
  return state.project.clusters;
}

function clusterTitle(g, i) {
  const t = tripSettings();
  if (t.titles[g.id]) return t.titles[g.id];
  if (g.city) return g.city;
  if (g.lat !== null && t.placeNames[placeKey(g.lat, g.lon)]) return t.placeNames[placeKey(g.lat, g.lon)];
  return `Étape ${i + 1}`;
}

let geocoding = false;

/**
 * Nomme en arrière-plan les étapes sans ville connue (Nominatim, 1 requête/s côté serveur).
 * `onUpdate` est appelé après chaque nom trouvé.
 */
export async function geocodeClusters(onUpdate) {
  if (geocoding) return;
  geocoding = true;
  const t = tripSettings();
  try {
    for (;;) {
      const c = state.project.clusters.find((x) => x.lat !== null && !x.city && !t.titles[x.id]
        && t.placeNames[placeKey(x.lat, x.lon)] === undefined);
      if (!c) break;
      const key = placeKey(c.lat, c.lon);
      try {
        const r = await api.geocode(c.lat, c.lon);
        t.placeNames[key] = r.label || '';
      } catch {
        t.placeNames[key] = '';
      }
      for (const [i, x] of state.project.clusters.entries()) {
        if (x.lat !== null && placeKey(x.lat, x.lon) === key && !x.city && !t.titles[x.id] && t.placeNames[key]) {
          x.title = t.placeNames[key];
        } else if (!x.title) {
          x.title = `Étape ${i + 1}`;
        }
      }
      markDirty();
      onUpdate?.();
    }
  } finally {
    geocoding = false;
  }
}
