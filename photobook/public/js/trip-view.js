// Onglet « Voyage » : découpage en étapes, carte interactive, création du livre.
import { api } from './api.js';
import { h, toast, debounce } from './ui.js';
import { state, photosSorted, markDirty, currentPage } from './state.js';
import { tripSettings, computeTrip, applySteps, geocodeClusters } from './trip.js';
import { generateBook, formatRange } from './book.js';

const COLORS = ['#d64834', '#2f7ed8', '#2a9d5c', '#e8a33d', '#8e5bd1', '#18a5a5', '#c2477e', '#6b8e23', '#b5651d', '#4a5ab5'];
export const clusterColor = (i) => COLORS[i % COLORS.length];

let map = null;
let layer = null;
let els = {};

export function render(el) {
  const t = tripSettings();
  if (!state.photos.size) {
    el.replaceChildren(h('div.empty', {}, h('p', {}, 'Commencez par importer des photos.'),
      h('a.button', { href: `#/p/${state.project.id}/photos` }, 'Importer des photos')));
    return;
  }
  computeTrip();
  const n = state.trip.hierarchy.n;

  els.slider = h('input', { type: 'range', min: 1, max: Math.max(1, Math.min(n, 60)), step: 1, 'aria-label': 'Nombre de cartes', oninput: onSlider });
  els.sliderLabel = h('output');
  els.list = h('ol.cluster-list');
  const num = (label, key, min, max, step) => h('label.field', {}, label, h('input', {
    type: 'number', min, max, step, value: t[key],
    onchange: (e) => { t[key] = Math.max(min, Math.min(max, Number(e.target.value) || min)); recompute(); },
  }));
  const cameras = [...new Set(photosSorted().map((p) => p.camera).filter(Boolean))];
  const density = h('select', { 'aria-label': 'Photos par page' },
    [[1, '1 photo par page'], [2, '2 photos par page'], [3, '3 photos par page'], [4, '4 photos par page'], [6, '6 photos par page']]
      .map(([v, l]) => h('option', { value: v, selected: v === (t.density || 3) }, l)));
  const opt = (label, key) => h('label.check', {}, h('input', { type: 'checkbox', checked: t[key] !== false, onchange: (e) => { t[key] = e.target.checked; markDirty(); } }), label);

  el.replaceChildren(h('div.trip-view', {},
    h('aside.trip-panel', {},
      h('section', {},
        h('h3', {}, 'Cartes / étapes'),
        h('div.slider-row', {}, h('span.muted', {}, 'Moins'), els.slider, h('span.muted', {}, 'Plus')),
        h('div.slider-info', {}, els.sliderLabel,
          h('button.link', { onclick: () => { t.steps = 0; update(); } }, 'Suggestion automatique')),
        h('details', {},
          h('summary', {}, 'Réglages du regroupement'),
          h('p.muted.small', {}, 'Deux groupes de photos sont séparés s’ils sont à plus de D km l’un de l’autre ou séparés de plus de T heures.'),
          h('div.fields', {}, num('Distance D (km)', 'distanceKm', 0.5, 2000, 0.5), num('Écart T (heures)', 'gapHours', 0.25, 240, 0.25)),
          cameras.length > 1 ? h('div', {},
            h('p.muted.small', {}, 'Décalage d’horloge par appareil (heures), pour remettre les photos dans l’ordre :'),
            cameras.map((c) => h('label.field', {}, c, h('input', {
              type: 'number', step: 0.25, value: t.cameraOffsets[c] || 0,
              onchange: (e) => { t.cameraOffsets[c] = Number(e.target.value) || 0; recompute(); },
            })))) : null)),
      h('section.grow', {}, h('h3', {}, 'Étapes'), els.list),
      h('section.make-book', {},
        h('h3', {}, 'Créer le livre'),
        density, opt('Couverture', 'cover'), opt('Carte globale du voyage', 'overview'), opt('Une carte par étape', 'chapterMaps'),
        h('button.primary', { onclick: () => makeBook(Number(density.value)) }, state.project.pages?.length ? 'Recréer le livre' : 'Créer le livre'))),
    h('div.trip-map', { id: 'trip-map' })));

  map = L.map('trip-map', { zoomControl: true });
  L.tileLayer(state.config.tileUrl, { attribution: state.config.tileAttribution, maxZoom: 18 }).addTo(map);
  layer = L.layerGroup().addTo(map);
  update(true);
}

export function destroy() {
  map?.remove();
  map = null;
}

const onSlider = (e) => {
  tripSettings().steps = Number(e.target.value);
  update();
};

const recompute = debounce(() => {
  computeTrip();
  update(true);
}, 250);

function update(fit = false) {
  const t = tripSettings();
  const clusters = applySteps();
  els.slider.value = clusters.length;
  els.sliderLabel.textContent = `${clusters.length} étape${clusters.length > 1 ? 's' : ''} (suggestion : ${state.trip.suggested})`;
  renderList();
  drawMap(fit);
  geocodeClusters(() => renderList());
  if (state.project.pages?.length && t.lastBookSteps !== undefined && t.lastBookSteps !== clusters.map((c) => c.id).join()) {
    els.list.prepend(h('li.notice', {}, 'Les étapes ont changé depuis la création du livre : pensez à le recréer.'));
  }
}

function renderList() {
  const t = tripSettings();
  const clusters = state.project.clusters;
  els.list.replaceChildren(...clusters.map((c, i) => {
    const from = state.photos.get(c.photoIds[0])?.takenAt;
    const to = state.photos.get(c.photoIds[c.photoIds.length - 1])?.takenAt;
    return h('li.cluster', {},
      h('span.num', { style: { background: clusterColor(i) } }, i + 1),
      h('div', {},
        h('input.cluster-title', {
          value: c.title, 'aria-label': `Nom de l’étape ${i + 1}`,
          onchange: (e) => { t.titles[c.id] = e.target.value; c.title = e.target.value; markDirty(); drawMap(false); },
        }),
        h('div.muted.small', {}, `${formatRange(from, to)} · ${c.photoIds.length} photo${c.photoIds.length > 1 ? 's' : ''}${c.lat === null ? ' · sans position' : ''}`),
        h('div.thumbs', {}, c.photoIds.slice(0, 6).map((id) => h('img', { src: api.previewUrl(state.project.id, id), loading: 'lazy', alt: '' })))));
  }));
}

function drawMap(fit) {
  if (!map) return;
  layer.clearLayers();
  const bounds = [];
  const clusters = state.project.clusters;
  clusters.forEach((c, i) => {
    for (const id of c.photoIds) {
      const pos = state.trip.positions.get(id);
      if (!pos || pos.lat === null) continue;
      L.circleMarker([pos.lat, pos.lon], {
        radius: 4, color: clusterColor(i), weight: pos.interpolated ? 1.5 : 1,
        fillOpacity: pos.interpolated ? 0 : 0.7,
      }).addTo(layer);
      bounds.push([pos.lat, pos.lon]);
    }
  });
  const located = clusters.map((c, i) => ({ c, i })).filter(({ c }) => c.lat !== null);
  L.polyline(located.map(({ c }) => [c.lat, c.lon]), { color: '#333', weight: 2, dashArray: '6 6', opacity: 0.7 }).addTo(layer);
  for (const { c, i } of located) {
    L.marker([c.lat, c.lon], {
      icon: L.divIcon({ className: 'step-icon', html: `<span style="background:${clusterColor(i)}">${i + 1}</span>`, iconSize: [26, 26] }),
      title: c.title,
    }).bindTooltip(c.title).addTo(layer);
  }
  if (fit) {
    if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    else map.setView([46.5, 2.5], 4);
  }
}

function makeBook(density) {
  const t = tripSettings();
  if (state.project.pages?.length && !confirm('Recréer le livre ? Les modifications faites dans l’onglet « Livre » seront perdues.')) return;
  t.density = density;
  const page = currentPage();
  state.project.pages = generateBook({
    name: state.project.name,
    clusters: state.project.clusters,
    photosById: state.photos,
    page,
    layouts: state.config.layouts,
    density,
    cover: t.cover !== false,
    overview: t.overview !== false,
    chapterMaps: t.chapterMaps !== false,
  });
  t.lastBookSteps = state.project.clusters.map((c) => c.id).join();
  markDirty();
  toast(`Livre créé : ${state.project.pages.length} pages.`);
  location.hash = `#/p/${state.project.id}/book`;
}
