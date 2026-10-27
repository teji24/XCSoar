// Onglet « Livre » : pages, dispositions, glisser-déposer des photos, format.
import { api } from './api.js';
import { h, toast, photoFilterCss } from './ui.js';
import { state, markDirty, flushSave, currentPage, photosSorted } from './state.js';
import { slotRect, specialRects, fitRegion, effectiveDpi, newPageId, bestLayout } from './book.js';
import { openPhotoEditor } from './photo-editor.js';

const PT_MM = 25.4 / 72;
const LOW_DPI = 150;

let els = {};
let selected = 0;
let selectedSlot = null;
let showAllPhotos = false;

export function render(el) {
  const p = state.project;
  if (!p.pages?.length) {
    el.replaceChildren(h('div.empty', {}, h('p', {}, 'Le livre n’a pas encore de pages.'),
      h('a.button', { href: `#/p/${p.id}/trip` }, 'Créer le livre depuis l’onglet « Voyage »')));
    return;
  }
  selected = Math.min(selected, p.pages.length - 1);
  els = {
    pages: h('div.page-list'),
    stage: h('div.stage'),
    inspector: h('aside.inspector'),
    tray: h('div.tray'),
    warnings: h('span.warnings'),
  };
  el.replaceChildren(h('div.book-view', {},
    formatBar(),
    h('div.book-main', {},
      h('div.page-column', {}, els.pages, h('div.add-pages', {},
        h('button', { onclick: () => addPage('photos') }, '+ Page photos'),
        h('button', { onclick: () => addPage('chapter') }, '+ Carte d’étape'),
        h('button', { onclick: () => addPage('overview') }, '+ Carte du voyage'))),
      els.stage,
      els.inspector),
    h('div.tray-wrap', {},
      h('div.tray-head', {}, h('strong', {}, 'Photos'),
        h('label.check', {}, h('input', { type: 'checkbox', checked: showAllPhotos, onchange: (e) => { showAllPhotos = e.target.checked; renderTray(); } }), 'Afficher aussi les photos déjà placées'),
        h('span.muted.small', {}, 'Glissez une photo sur un emplacement, ou sélectionnez un emplacement puis cliquez une photo.')),
      els.tray)));
  window.addEventListener('resize', onResize);
  refreshAll();
}

export function destroy() {
  window.removeEventListener('resize', onResize);
}

const onResize = () => renderStage();

function refreshAll() {
  renderPageList();
  renderStage();
  renderInspector();
  renderTray();
  renderWarnings();
}

function changed({ list = true, stage = true, inspector = true, tray = true } = {}) {
  markDirty();
  if (list) renderPageList();
  if (stage) renderStage();
  if (inspector) renderInspector();
  if (tray) renderTray();
  renderWarnings();
}

// --- Barre de format ------------------------------------------------------------

function formatBar() {
  const f = state.project.format;
  const sizes = state.config.formats;
  const set = (key, value) => {
    f[key] = value;
    changed();
  };
  const orientation = h('select', { 'aria-label': 'Orientation', disabled: sizes[f.size]?.width === sizes[f.size]?.height, onchange: (e) => set('orientation', e.target.value) },
    h('option', { value: 'portrait', selected: f.orientation === 'portrait' }, 'Portrait'),
    h('option', { value: 'landscape', selected: f.orientation === 'landscape' }, 'Paysage'));
  const mm = (label, key, max) => h('label.inline', {}, label, h('input', {
    type: 'number', min: 0, max, step: 0.5, value: f[key], onchange: (e) => set(key, Number(e.target.value) || 0),
  }), 'mm');
  return h('div.format-bar', {},
    h('label.inline', {}, 'Format', h('select', {
      onchange: (e) => {
        f.size = e.target.value;
        orientation.disabled = sizes[f.size].width === sizes[f.size].height;
        changed();
      },
    }, Object.entries(sizes).map(([id, s]) => h('option', { value: id, selected: id === f.size }, `${s.label} (${s.width}×${s.height} mm)`)))),
    orientation,
    mm('Fond perdu', 'bleed', 10), mm('Marges', 'margin', 40), mm('Espacement', 'gap', 20),
    els.warnings);
}

function renderWarnings() {
  const page = currentPage();
  let low = 0;
  for (const pg of state.project.pages) {
    forEachSlot(pg, page, (photo, r) => { if (effectiveDpi(photo, r.w, r.h) < LOW_DPI) low++; });
  }
  els.warnings.replaceChildren(low ? h('span.warn', { title: `Moins de ${LOW_DPI} dpi à l’impression` }, `${low} photo(s) en basse résolution`) : '');
}

// --- Rendu d'une page (aperçu fidèle au PDF) ---------------------------------------

function layoutOf(pg) {
  if (pg.type === 'cover') return state.config.layouts['full-bleed'];
  return state.config.layouts[pg.layout] || state.config.layouts.single;
}

function forEachSlot(pg, page, fn) {
  if (pg.type !== 'photos' && pg.type !== 'cover') return;
  const layout = layoutOf(pg);
  layout.slots.forEach((s, k) => {
    const photo = state.photos.get(pg.slots?.[k]);
    if (photo) fn(photo, slotRect(page, s, !!layout.bleed), k);
  });
}

function hash(s) {
  let x = 0;
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0;
  return (x >>> 0).toString(36);
}

function mapVersion(pg) {
  const clusters = state.project.clusters.map((c) => [c.id, c.lat, c.lon, c.title]);
  return hash(JSON.stringify([state.project.format, clusters, pg.type, pg.clusterId]));
}

function textBlock(r, title, subtitle, titlePt, s, page) {
  const size = titlePt * (Math.min(page.width, page.height) / 210);
  return h('div.el.text', { style: box(r, s) },
    h('div.title', { style: { fontSize: `${size * PT_MM * s}px` } }, title || ''),
    subtitle ? h('div.subtitle', { style: { fontSize: `${size * 0.45 * PT_MM * s}px` } }, subtitle) : null);
}

const box = (r, s) => ({ left: `${r.x * s}px`, top: `${r.y * s}px`, width: `${r.w * s}px`, height: `${r.h * s}px` });

/** Construit l'aperçu d'une page à l'échelle `s` (pixels par mm). */
function pageElement(pg, s, interactive) {
  const page = currentPage();
  const W = page.width + 2 * page.bleed;
  const H = page.height + 2 * page.bleed;
  const el = h('div.sheet', { style: { width: `${W * s}px`, height: `${H * s}px` } });

  if (pg.type === 'photos' || pg.type === 'cover') {
    const layout = layoutOf(pg);
    layout.slots.forEach((slot, k) => el.append(slotElement(pg, k, slotRect(page, slot, !!layout.bleed), s, interactive)));
  }
  if (pg.type === 'cover' && pg.title) {
    const w = page.width * 0.7;
    const size = Math.min(page.width, page.height) / 210 * 30;
    el.append(h('div.el.cover-box', {
      style: { left: `${(page.bleed + (page.width - w) / 2) * s}px`, bottom: `${(page.bleed + page.height * 0.1) * s}px`, width: `${w * s}px`, padding: `${6 * s}px ${8 * s}px` },
    }, h('div.title', { style: { fontSize: `${size * PT_MM * s}px` } }, pg.title),
    pg.subtitle ? h('div.subtitle', { style: { fontSize: `${size * 0.45 * PT_MM * s}px` } }, pg.subtitle) : null));
  }
  if (pg.type === 'overview' || pg.type === 'chapter') {
    const rects = specialRects(page, pg.type);
    const img = h('img', { alt: 'Carte' });
    el.append(h('div.el.map', { style: box(rects.map, s) }, img));
    el.append(textBlock(rects.text, pg.title, pg.subtitle, pg.type === 'overview' ? 20 : 24, s, page));
    // La carte est rendue par le serveur à partir du projet enregistré.
    flushSave().then(() => { img.src = api.mapUrl(state.project.id, pg.id, mapVersion(pg)); });
  }
  if (interactive && page.bleed > 0) {
    el.append(h('div.trim', { style: { inset: `${page.bleed * s}px` } }));
    el.append(h('div.safe', { style: { inset: `${(page.bleed + page.margin) * s}px` } }));
  }
  return el;
}

function slotElement(pg, k, r, s, interactive) {
  const photo = state.photos.get(pg.slots?.[k]);
  const el = h(`div.el.slot${interactive && selectedSlot === k ? '.selected' : ''}`, { style: box(r, s) });
  if (photo) {
    const reg = fitRegion(photo.width, photo.height, photo.crop, r.w / r.h);
    const scale = (r.w * s) / reg.w;
    el.append(h('img', {
      src: api.previewUrl(state.project.id, photo.id), alt: '', draggable: false,
      style: {
        width: `${photo.width * scale}px`, height: `${photo.height * scale}px`,
        left: `${-reg.x * scale}px`, top: `${-reg.y * scale}px`, filter: photoFilterCss(photo),
      },
    }));
    if (interactive && effectiveDpi(photo, r.w, r.h) < LOW_DPI) {
      el.append(h('span.lowres', { title: 'Résolution insuffisante pour cette taille' }, `${Math.round(effectiveDpi(photo, r.w, r.h))} dpi`));
    }
  } else if (interactive) {
    el.append(h('span.placeholder', {}, 'Déposez une photo'));
  }
  if (!interactive) return el;

  el.addEventListener('click', () => {
    selectedSlot = k;
    renderStage();
    renderInspector();
  });
  el.addEventListener('dblclick', () => photo && editPhoto(photo, r));
  if (photo) {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', JSON.stringify({ photoId: photo.id, slot: k })));
  }
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    let data;
    try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
    placePhoto(pg, k, data.photoId, data.slot);
  });
  return el;
}

/** Place une photo dans un emplacement ; depuis un autre emplacement de la page, échange les deux. */
function placePhoto(pg, k, photoId, fromSlot) {
  const layout = layoutOf(pg);
  pg.slots = Array.from({ length: layout.slots.length }, (_, i) => pg.slots?.[i] ?? null);
  if (fromSlot !== undefined && fromSlot !== null) {
    [pg.slots[k], pg.slots[fromSlot]] = [pg.slots[fromSlot], pg.slots[k]];
  } else {
    pg.slots[k] = photoId;
  }
  selectedSlot = k;
  changed();
}

function editPhoto(photo, r) {
  openPhotoEditor(photo, r ? r.w / r.h : null, () => changed({ inspector: true }));
}

// --- Colonnes --------------------------------------------------------------------

const PAGE_LABELS = { cover: 'Couverture', overview: 'Carte du voyage', chapter: 'Carte d’étape', photos: 'Photos' };

function renderPageList() {
  const page = currentPage();
  const s = 150 / (page.width + 2 * page.bleed);
  els.pages.replaceChildren(...state.project.pages.map((pg, i) => h(`button.page-thumb${i === selected ? '.active' : ''}`, {
    onclick: () => { selected = i; selectedSlot = null; refreshAll(); },
    'aria-label': `Page ${i + 1}`,
  }, pageElement(pg, s, false), h('span.small', {}, `${i + 1}. ${PAGE_LABELS[pg.type] || ''}`))));
  els.pages.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
}

function renderStage() {
  const pg = state.project.pages[selected];
  if (!pg || !els.stage.isConnected) return;
  const page = currentPage();
  const W = page.width + 2 * page.bleed;
  const H = page.height + 2 * page.bleed;
  const avail = els.stage.getBoundingClientRect();
  const s = Math.max(1, Math.min((avail.width - 48) / W, (avail.height - 48) / H));
  els.stage.replaceChildren(pageElement(pg, s, true));
}

function renderInspector() {
  const pg = state.project.pages[selected];
  const page = currentPage();
  const parts = [h('h3', {}, `Page ${selected + 1} · ${PAGE_LABELS[pg.type]}`)];
  const text = (label, key) => h('label.field', {}, label, h('input', {
    value: pg[key] || '', oninput: (e) => { pg[key] = e.target.value; changed({ list: true, stage: true, inspector: false, tray: false }); },
  }));

  if (pg.type === 'photos') {
    parts.push(h('div.layout-picker', {}, Object.entries(state.config.layouts).map(([id, l]) => {
      const icon = h(`button.layout-icon${pg.layout === id ? '.active' : ''}`, {
        title: l.label, 'aria-label': l.label,
        style: { aspectRatio: `${page.width} / ${page.height}` },
        onclick: () => setLayout(pg, id),
      });
      for (const sl of l.slots) {
        icon.append(h('span', { style: { left: `${sl[0] * 100}%`, top: `${sl[1] * 100}%`, width: `${sl[2] * 100}%`, height: `${sl[3] * 100}%` } }));
      }
      return icon;
    })));
    parts.push(h('button', { onclick: () => autoLayout(pg) }, 'Disposition automatique'));
  }
  if (pg.type !== 'photos') parts.push(text('Titre', 'title'), text('Sous-titre', 'subtitle'));
  if (pg.type === 'chapter') {
    parts.push(h('label.field', {}, 'Étape', h('select', {
      onchange: (e) => { pg.clusterId = e.target.value; changed(); },
    }, state.project.clusters.map((c, i) => h('option', { value: c.id, selected: c.id === pg.clusterId }, `${i + 1}. ${c.title}`)))));
  }

  const layout = layoutOf(pg);
  const photo = selectedSlot !== null ? state.photos.get(pg.slots?.[selectedSlot]) : null;
  if (photo) {
    const r = slotRect(page, layout.slots[selectedSlot], !!layout.bleed);
    parts.push(h('div.slot-info', {},
      h('h4', {}, 'Photo sélectionnée'),
      h('p.small', {}, photo.name),
      h('p.small.muted', {}, `${Math.round(r.w)} × ${Math.round(r.h)} mm · ${Math.round(effectiveDpi(photo, r.w, r.h))} dpi`),
      h('button.primary', { onclick: () => editPhoto(photo, r) }, 'Recadrer et ajuster…'),
      h('label.field', {}, 'Légende', h('input', {
        value: photo.caption || '',
        onchange: async (e) => {
          const updated = await api.updatePhoto(state.project.id, photo.id, { caption: e.target.value });
          state.photos.set(updated.id, updated);
        },
      })),
      h('button', { onclick: () => { pg.slots[selectedSlot] = null; changed(); } }, 'Retirer de la page')));
  }

  parts.push(h('div.grow'), h('div.page-actions', {},
    h('button', { onclick: () => movePage(-1), disabled: selected === 0 }, '↑ Monter'),
    h('button', { onclick: () => movePage(1), disabled: selected === state.project.pages.length - 1 }, '↓ Descendre'),
    h('button.danger', { onclick: deletePage }, 'Supprimer la page')));
  els.inspector.replaceChildren(...parts);
}

function renderTray() {
  const used = new Set(state.project.pages.flatMap((pg) => (pg.type === 'photos' || pg.type === 'cover' ? pg.slots || [] : [])));
  const photos = photosSorted().filter((p) => showAllPhotos || !used.has(p.id));
  els.tray.replaceChildren(...(photos.length ? photos.map((p) => h(`img.tray-photo${used.has(p.id) ? '.used' : ''}`, {
    src: api.previewUrl(state.project.id, p.id), loading: 'lazy', alt: p.name, title: p.name, draggable: true,
    ondragstart: (e) => e.dataTransfer.setData('text/plain', JSON.stringify({ photoId: p.id })),
    onclick: () => {
      const pg = state.project.pages[selected];
      if (selectedSlot === null || (pg.type !== 'photos' && pg.type !== 'cover')) {
        toast('Sélectionnez d’abord un emplacement dans la page.');
        return;
      }
      placePhoto(pg, selectedSlot, p.id);
    },
  })) : [h('p.muted.small', {}, 'Toutes les photos sont placées.')]));
}

// --- Actions ---------------------------------------------------------------------

function setLayout(pg, id) {
  const n = state.config.layouts[id].slots.length;
  const photos = (pg.slots || []).filter(Boolean);
  pg.layout = id;
  pg.slots = Array.from({ length: n }, (_, i) => photos[i] ?? null);
  selectedSlot = null;
  changed();
}

function autoLayout(pg) {
  const photos = (pg.slots || []).filter(Boolean).map((id) => state.photos.get(id)).filter(Boolean);
  if (!photos.length) return;
  Object.assign(pg, bestLayout(photos.slice(0, 6), currentPage(), state.config.layouts));
  changed();
}

function addPage(type) {
  const pg = { id: newPageId(), type };
  if (type === 'photos') Object.assign(pg, { layout: 'single', slots: [null] });
  if (type === 'chapter') {
    const c = state.project.clusters[0];
    Object.assign(pg, { clusterId: c?.id, title: c?.title || 'Étape', subtitle: '' });
  }
  if (type === 'overview') Object.assign(pg, { title: 'Le voyage', subtitle: '' });
  state.project.pages.splice(selected + 1, 0, pg);
  selected++;
  selectedSlot = null;
  changed();
}

function movePage(dir) {
  const pages = state.project.pages;
  const j = selected + dir;
  [pages[selected], pages[j]] = [pages[j], pages[selected]];
  selected = j;
  changed();
}

function deletePage() {
  if (state.project.pages.length <= 1) {
    toast('Le livre doit garder au moins une page.');
    return;
  }
  state.project.pages.splice(selected, 1);
  selected = Math.max(0, selected - 1);
  selectedSlot = null;
  changed();
}
