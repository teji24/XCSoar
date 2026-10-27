import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepare, buildHierarchy, cut, suggestK, summarize } from '../public/js/clustering.js';
import { chunkSizes, bestLayout, pageSize, fitRegion } from '../public/js/book.js';

// Voyage fictif : 3 villes, ~10 photos chacune, une journée par ville.
const cities = [
  ['Lisbonne', 38.72, -9.14],
  ['Porto', 41.15, -8.61],
  ['Coimbra', 40.21, -8.43],
];
const photos = [];
let t = Date.UTC(2026, 4, 1, 9) / 1000;
cities.forEach(([city, lat, lon], c) => {
  for (let i = 0; i < 10; i++) {
    photos.push({ id: `${c}-${i}`, ts: t + i * 1800, lat: lat + i * 0.002, lon: lon + i * 0.002, city, camera: 'Phone' });
  }
  t += 86400;
});

test('retrouve les trois villes', () => {
  const items = prepare(photos);
  const h = buildHierarchy(items, { distanceKm: 20, gapHours: 48 });
  assert.equal(suggestK(h), 3);
  const groups = summarize(cut(h, 3), items, new Map(photos.map((p) => [p.id, p])));
  assert.deepEqual(groups.map((g) => g.city), ['Lisbonne', 'Porto', 'Coimbra']);
  assert.ok(groups.every((g) => g.photoIds.length === 10));
});

test('le curseur affine le découpage sans casser l’ordre', () => {
  const items = prepare(photos);
  const h = buildHierarchy(items);
  for (let k = 1; k <= 12; k++) {
    const groups = cut(h, k);
    assert.equal(groups.length, k);
    assert.deepEqual(groups.flat(), items.map((_, i) => i));
  }
});

test('interpole la position des photos sans GPS', () => {
  const p = [
    { id: 'a', ts: 0, lat: 10, lon: 10 },
    { id: 'b', ts: 1800, lat: null, lon: null },
    { id: 'c', ts: 3600, lat: 12, lon: 12 },
    { id: 'd', ts: 100000, lat: null, lon: null },
  ];
  const items = prepare(p);
  assert.equal(items[1].lat, 11);
  assert.equal(items[1].interpolated, true);
  assert.equal(items[3].lat, null);
});

test('décalage horaire d’un appareil', () => {
  const p = [
    { id: 'phone', ts: 3600, camera: 'Phone', lat: 1, lon: 1 },
    { id: 'cam', ts: 0, camera: 'Cam', lat: 1, lon: 1 },
  ];
  assert.deepEqual(prepare(p, { Cam: 2 }).map((i) => i.id), ['phone', 'cam']);
});

test('pagination et choix de disposition', () => {
  assert.deepEqual(chunkSizes(10, 3), [3, 4, 3]);
  for (let n = 1; n < 40; n++) {
    for (const d of [1, 2, 3, 4, 6]) {
      const s = chunkSizes(n, d);
      assert.equal(s.reduce((a, b) => a + b, 0), n);
      assert.ok(s.every((x) => [1, 2, 3, 4, 6].includes(x)));
    }
  }
  const page = pageSize({ size: 'A4', orientation: 'landscape' }, { A4: { width: 210, height: 297 } });
  const layouts = {
    'two-cols': { slots: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]] },
    'two-rows': { slots: [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]] },
  };
  const portraits = [{ id: 'x', width: 3000, height: 4000 }, { id: 'y', width: 3000, height: 4000 }];
  assert.equal(bestLayout(portraits, page, layouts).layout, 'two-cols');
  const r = fitRegion(4000, 3000, null, 1);
  assert.deepEqual(r, { x: 500, y: 0, w: 3000, h: 3000 });
});

test('plusieurs jours au même endroit restent une seule étape', () => {
  const day = 86400;
  const p = [];
  for (let d = 0; d < 3; d++) {
    for (let i = 0; i < 4; i++) p.push({ id: `l${d}${i}`, ts: d * day + i * 3600, lat: 38.72, lon: -9.14 });
  }
  for (let i = 0; i < 4; i++) p.push({ id: `p${i}`, ts: 3 * day + i * 3600, lat: 41.15, lon: -8.61 });
  const h = buildHierarchy(prepare(p));
  assert.equal(suggestK(h), 2);
  // Un cran de plus sur le curseur découpe par journée.
  assert.equal(cut(h, 3).length, 3);
});
