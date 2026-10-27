// Regroupement spatio-temporel des photos en étapes de voyage.
//
// Principe : les photos sont triées par heure, puis on fusionne pas à pas les deux
// groupes *voisins dans le temps* les plus proches, selon un coût qui combine distance
// et écart de temps :  coût = √((distance / D)² + (écart / T)²).
// L'historique des fusions est conservé : obtenir k étapes revient à rejouer les
// n − k premières fusions, ce qui rend le curseur « cartes » instantané.

export function haversineKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const hasPos = (p) => p.lat !== null && p.lat !== undefined && p.lon !== null && p.lon !== undefined;

/**
 * Prépare les photos : heure corrigée du décalage de l'appareil, tri chronologique et
 * position estimée pour les photos sans GPS (interpolée entre les voisines si elles
 * sont assez proches dans le temps).
 */
export function prepare(photos, cameraOffsets = {}, maxInterpolationHours = 6) {
  const items = photos
    .filter((p) => p.ts !== null && p.ts !== undefined)
    .map((p) => ({
      id: p.id,
      t: p.ts + (Number(cameraOffsets[p.camera] || 0) * 3600),
      lat: hasPos(p) ? p.lat : null,
      lon: hasPos(p) ? p.lon : null,
      interpolated: false,
    }))
    .sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));

  const limit = maxInterpolationHours * 3600;
  let prev = -1;
  for (let i = 0; i < items.length; i++) {
    if (items[i].lat !== null) {
      prev = i;
      continue;
    }
    let next = i + 1;
    while (next < items.length && items[next].lat === null) next++;
    const a = prev >= 0 && items[i].t - items[prev].t <= limit ? items[prev] : null;
    const b = next < items.length && items[next].t - items[i].t <= limit ? items[next] : null;
    if (a && b) {
      const f = b.t === a.t ? 0.5 : (items[i].t - a.t) / (b.t - a.t);
      items[i].lat = a.lat + (b.lat - a.lat) * f;
      items[i].lon = a.lon + (b.lon - a.lon) * f;
    } else if (a || b) {
      items[i].lat = (a || b).lat;
      items[i].lon = (a || b).lon;
    }
    if (items[i].lat !== null) items[i].interpolated = true;
  }
  return items;
}

/** Construit l'historique des fusions. */
export function buildHierarchy(items, { distanceKm = 20, gapHours = 48 } = {}) {
  const n = items.length;
  // Groupes sous forme de liste doublement chaînée (seuls les voisins peuvent fusionner).
  const groups = items.map((it, i) => ({
    first: i, start: it.t, end: it.t,
    sumLat: it.lat ?? 0, sumLon: it.lon ?? 0, nPos: it.lat !== null ? 1 : 0,
    prev: i - 1, next: i + 1 < n ? i + 1 : -1, alive: true,
  }));
  const cost = (a, b) => {
    let d = 0;
    if (a.nPos && b.nPos) {
      d = haversineKm(a.sumLat / a.nPos, a.sumLon / a.nPos, b.sumLat / b.nPos, b.sumLon / b.nPos);
    }
    const gap = Math.max(0, b.start - a.end) / 3600;
    return Math.hypot(d / distanceKm, gap / gapHours);
  };
  // linkCost[i] = coût de fusion du groupe i avec son suivant.
  const linkCost = new Float64Array(n).fill(Infinity);
  for (let i = 0; i + 1 < n; i++) linkCost[i] = cost(groups[i], groups[i + 1]);

  const merges = [];
  for (let step = 0; step < n - 1; step++) {
    // Le groupe 0 reste toujours en tête : c'est toujours le groupe de gauche qui survit.
    let best = -1;
    for (let g = 0; g !== -1; g = groups[g].next) {
      if (groups[g].next !== -1 && (best === -1 || linkCost[g] < linkCost[best])) best = g;
    }
    const a = groups[best];
    const bi = a.next;
    const b = groups[bi];
    merges.push({ left: best, right: bi, cost: linkCost[best] });
    a.end = b.end;
    a.sumLat += b.sumLat;
    a.sumLon += b.sumLon;
    a.nPos += b.nPos;
    a.next = b.next;
    b.alive = false;
    if (b.next !== -1) groups[b.next].prev = best;
    linkCost[bi] = Infinity;
    linkCost[best] = a.next !== -1 ? cost(a, groups[a.next]) : Infinity;
    if (a.prev !== -1) linkCost[a.prev] = cost(groups[a.prev], a);
  }
  return { n, merges };
}

/** Découpe en k étapes : renvoie des listes d'indices (ordre chronologique). */
export function cut(hierarchy, k) {
  const { n, merges } = hierarchy;
  if (n === 0) return [];
  k = Math.max(1, Math.min(n, Math.round(k)));
  // Chaque groupe est identifié par l'indice de sa première photo ; une fusion
  // absorbe le groupe de droite dans celui de gauche.
  const owner = Array.from({ length: n }, (_, i) => i);
  const find = (i) => {
    while (owner[i] !== i) {
      owner[i] = owner[owner[i]];
      i = owner[i];
    }
    return i;
  };
  for (let s = 0; s < n - k; s++) owner[find(merges[s].right)] = find(merges[s].left);
  const out = [];
  let current = -1;
  for (let i = 0; i < n; i++) {
    const g = find(i);
    if (g !== current) {
      out.push([]);
      current = g;
    }
    out[out.length - 1].push(i);
  }
  return out;
}

/**
 * Nombre d'étapes suggéré : on garde séparés les groupes dont le coût de fusion
 * dépasse 1, c'est-à-dire plus éloignés que D ou séparés de plus de T (à peu près).
 */
export function suggestK(hierarchy, maxK = 40) {
  const above = hierarchy.merges.filter((m) => m.cost > 1).length;
  return Math.max(1, Math.min(maxK, hierarchy.n, above + 1));
}

const mode = (values) => {
  const counts = new Map();
  let best = null;
  for (const v of values) {
    if (!v) continue;
    const c = (counts.get(v) || 0) + 1;
    counts.set(v, c);
    if (best === null || c > counts.get(best)) best = v;
  }
  return best;
};

/** Résumé de chaque étape : photos, centre, dates, ville la plus fréquente. */
export function summarize(groups, items, photosById) {
  return groups.map((idx) => {
    const its = idx.map((i) => items[i]);
    const real = its.filter((it) => it.lat !== null && !it.interpolated);
    const pos = real.length ? real : its.filter((it) => it.lat !== null);
    const photos = its.map((it) => photosById.get(it.id)).filter(Boolean);
    return {
      id: its[0].id,
      photoIds: its.map((it) => it.id),
      lat: pos.length ? pos.reduce((s, it) => s + it.lat, 0) / pos.length : null,
      lon: pos.length ? pos.reduce((s, it) => s + it.lon, 0) / pos.length : null,
      start: its[0].t,
      end: its[its.length - 1].t,
      city: mode(photos.map((p) => p.city)),
      country: mode(photos.map((p) => p.country)),
    };
  });
}

/** Positions corrigées (interpolées) par identifiant de photo. */
export function positionsById(items) {
  const m = new Map();
  for (const it of items) m.set(it.id, it);
  return m;
}
