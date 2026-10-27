// Géométrie des pages et mise en page automatique.
// slotRect() et fitRegion() reproduisent exactement Format::slotRect() et
// ImageProcessor::coverRegion() côté PHP : l'aperçu correspond au PDF.

export const FORMAT_DEFAULT = { size: 'A4', orientation: 'landscape', bleed: 3, margin: 12, gap: 4 };

export function pageSize(format, formats) {
  const f = { ...FORMAT_DEFAULT, ...format };
  const s = formats[f.size] || formats.A4;
  let w = s.width;
  let h = s.height;
  if (f.orientation === 'landscape' && w !== h) [w, h] = [h, w];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, Number(v) || 0));
  return {
    width: w, height: h,
    bleed: clamp(f.bleed, 0, 10), margin: clamp(f.margin, 0, 40), gap: clamp(f.gap, 0, 20),
  };
}

export function slotRect(page, slot, fullBleed) {
  const b = page.bleed;
  let x0, y0, cw, ch, g;
  if (fullBleed) {
    x0 = 0; y0 = 0; g = 0;
    cw = page.width + 2 * b;
    ch = page.height + 2 * b;
  } else {
    g = page.gap;
    x0 = b + page.margin - g / 2;
    y0 = b + page.margin - g / 2;
    cw = page.width - 2 * page.margin + g;
    ch = page.height - 2 * page.margin + g;
  }
  return {
    x: x0 + slot[0] * cw + g / 2,
    y: y0 + slot[1] * ch + g / 2,
    w: Math.max(1, slot[2] * cw - g),
    h: Math.max(1, slot[3] * ch - g),
  };
}

/** Zones des pages « carte » (identiques à BookRenderer::overviewRects/chapterRects). */
export function specialRects(page, type) {
  const full = slotRect(page, [0, 0, 1, 1], false);
  if (type === 'overview') {
    const band = Math.min(28, full.h * 0.16);
    return {
      text: { x: full.x, y: full.y, w: full.w, h: band },
      map: { x: full.x, y: full.y + band, w: full.w, h: full.h - band },
    };
  }
  const mapH = full.h * 0.74;
  return {
    map: { x: full.x, y: full.y, w: full.w, h: mapH },
    text: { x: full.x, y: full.y + mapH + 6, w: full.w, h: full.h - mapH - 6 },
  };
}

/** Région de l'image (pixels) affichée dans un emplacement de rapport `aspect`. */
export function fitRegion(imgW, imgH, crop, aspect) {
  const c = crop || { x: 0, y: 0, w: 1, h: 1 };
  let rx = c.x * imgW;
  let ry = c.y * imgH;
  let rw = Math.max(1, c.w * imgW);
  let rh = Math.max(1, c.h * imgH);
  if (rw / rh > aspect) {
    const nw = rh * aspect;
    rx += (rw - nw) / 2;
    rw = nw;
  } else {
    const nh = rw / aspect;
    ry += (rh - nh) / 2;
    rh = nh;
  }
  return { x: rx, y: ry, w: rw, h: rh };
}

/** Résolution effective (dpi) d'une photo dans un emplacement de `slotWmm` mm de large. */
export function effectiveDpi(photo, slotWmm, slotHmm) {
  const r = fitRegion(photo.width, photo.height, photo.crop, slotWmm / slotHmm);
  return r.w / (slotWmm / 25.4);
}

export const photoAspect = (p) => (p.crop ? (p.crop.w * p.width) / (p.crop.h * p.height) : p.width / p.height);

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p]));
}

/**
 * Choisit la disposition (et l'ordre des photos) qui minimise la perte au recadrage :
 * somme des |ln(rapport emplacement / rapport photo)|, avec une petite pénalité quand
 * on s'écarte de l'ordre chronologique.
 */
export function bestLayout(photos, page, layouts) {
  let best = null;
  for (const [id, layout] of Object.entries(layouts)) {
    if (layout.slots.length !== photos.length) continue;
    const rects = layout.slots.map((s) => slotRect(page, s, !!layout.bleed));
    const orders = photos.length <= 4 ? permutations(photos.map((_, i) => i)) : [photos.map((_, i) => i)];
    for (const order of orders) {
      let score = 0;
      order.forEach((pi, si) => {
        score += Math.abs(Math.log((rects[si].w / rects[si].h) / photoAspect(photos[pi])));
        if (pi !== si) score += 0.02;
      });
      if (layout.bleed) score += 0.15; // pleine page seulement si le cadrage s'y prête vraiment
      if (!best || score < best.score) best = { id, order, score };
    }
  }
  return best ? { layout: best.id, slots: best.order.map((i) => photos[i].id) } : { layout: 'single', slots: [photos[0].id] };
}

/** Répartit n photos en pages d'environ `density` photos (tailles disponibles : 1, 2, 3, 4, 6). */
export function chunkSizes(n, density) {
  if (n <= 0) return [];
  const pages = Math.max(1, Math.round(n / density));
  const sizes = [];
  let left = n;
  for (let p = pages; p > 0; p--) {
    const s = Math.round(left / p);
    sizes.push(s);
    left -= s;
  }
  const out = [];
  for (let s of sizes) {
    while (s > 6) { out.push(4); s -= 4; }
    if (s === 5) out.push(3, 2);
    else if (s > 0) out.push(s);
  }
  return out;
}

let uid = 0;
export const newPageId = () => `p${Date.now().toString(36)}${(uid++).toString(36)}`;

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const dayFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });

export function formatRange(fromIso, toIso) {
  if (!fromIso) return '';
  const a = new Date(fromIso);
  const b = new Date(toIso || fromIso);
  if (a.toDateString() === b.toDateString()) return dateFmt.format(a);
  if (a.getFullYear() === b.getFullYear()) return `${dayFmt.format(a)} – ${dateFmt.format(b)}`;
  return `${dateFmt.format(a)} – ${dateFmt.format(b)}`;
}

/** Génère toutes les pages du livre à partir des étapes. */
export function generateBook({ name, clusters, photosById, page, layouts, density = 3, cover = true, overview = true, chapterMaps = true }) {
  const pages = [];
  const allIds = clusters.flatMap((c) => c.photoIds);
  const first = photosById.get(allIds[0]);
  const last = photosById.get(allIds[allIds.length - 1]);
  if (!allIds.length) return pages;

  const used = new Set();
  if (cover) {
    const pageAspect = page.width / page.height;
    const candidates = allIds.map((id) => photosById.get(id));
    const pick = candidates.reduce((best, p) =>
      Math.abs(Math.log(photoAspect(p) / pageAspect)) < Math.abs(Math.log(photoAspect(best) / pageAspect)) ? p : best);
    pages.push({ id: newPageId(), type: 'cover', layout: 'full-bleed', slots: [pick.id], title: name, subtitle: formatRange(first?.takenAt, last?.takenAt) });
    used.add(pick.id);
  }
  const located = clusters.filter((c) => c.lat !== null);
  if (overview && located.length >= 2) {
    pages.push({ id: newPageId(), type: 'overview', title: 'Le voyage', subtitle: located.map((c) => c.title).filter(Boolean).join(' · ') });
  }
  for (const c of clusters) {
    const ids = c.photoIds.filter((id) => !used.has(id));
    const photos = ids.map((id) => photosById.get(id)).filter(Boolean);
    const from = photosById.get(c.photoIds[0])?.takenAt;
    const to = photosById.get(c.photoIds[c.photoIds.length - 1])?.takenAt;
    if (chapterMaps && c.lat !== null) {
      pages.push({
        id: newPageId(), type: 'chapter', clusterId: c.id, title: c.title || '',
        subtitle: `${formatRange(from, to)} · ${c.photoIds.length} photo${c.photoIds.length > 1 ? 's' : ''}`,
      });
    }
    let i = 0;
    for (const size of chunkSizes(photos.length, density)) {
      const chunk = photos.slice(i, i + size);
      i += size;
      pages.push({ id: newPageId(), type: 'photos', clusterId: c.id, ...bestLayout(chunk, page, layouts) });
    }
  }
  return pages;
}
