// Onglet « Photos » : import depuis l'ordinateur ou Immich, liste des photos.
import { api } from './api.js';
import { h, toast, modal, pool, dateTimeFmt } from './ui.js';
import { state, photosSorted } from './state.js';

let container = null;

export function render(el) {
  container = el;
  const input = h('input', { type: 'file', multiple: true, accept: 'image/jpeg,image/png,image/webp', hidden: true, onchange: (e) => upload([...e.target.files]) });
  const drop = h('label.dropzone', {
    ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); },
    ondragleave: () => drop.classList.remove('over'),
    ondrop: (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      upload([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/')));
    },
  }, input, h('strong', {}, 'Déposez vos photos ici'), h('span.muted', {}, 'ou cliquez pour les choisir (JPEG, PNG, WebP)'));
  el.replaceChildren(h('div.photos-view', {},
    h('div.import-row', {}, drop,
      state.config.immich ? h('button.big', { onclick: openImmich }, h('strong', {}, 'Importer depuis Immich'), h('span.muted', {}, 'Choisir un album')) : null),
    h('div.progress', { hidden: true }),
    h('div.stats'),
    h('div.photo-grid')));
  refresh();
}

function refresh() {
  const photos = photosSorted();
  const located = photos.filter((p) => p.lat !== null).length;
  container.querySelector('.stats').replaceChildren(photos.length
    ? h('p', {}, `${photos.length} photo${photos.length > 1 ? 's' : ''}, dont ${located} géolocalisée${located > 1 ? 's' : ''}. `,
      photos.length ? h('a', { href: `#/p/${state.project.id}/trip` }, 'Retracer le voyage →') : null)
    : h('p.muted', {}, 'Aucune photo pour l’instant.'));
  container.querySelector('.photo-grid').replaceChildren(...photos.map(card));
}

function card(p) {
  return h('figure.photo-card', {},
    h('img', { src: api.previewUrl(state.project.id, p.id), loading: 'lazy', alt: p.name }),
    h('figcaption', {},
      h('span', {}, p.takenAt ? dateTimeFmt.format(new Date(p.takenAt)) : 'Date inconnue', p.dateGuessed ? ' (date du fichier)' : ''),
      h(`span.badge${p.lat !== null ? '.ok' : ''}`, {}, p.lat !== null ? (p.city || 'GPS') : 'sans GPS')),
    h('button.icon.remove', {
      title: 'Retirer', 'aria-label': `Retirer ${p.name}`,
      onclick: async () => {
        await api.deletePhoto(state.project.id, p.id);
        state.photos.delete(p.id);
        state.trip = null;
        refresh();
      },
    }, '×'));
}

function progress(done, total, label) {
  const el = container?.querySelector('.progress');
  if (!el) return;
  el.hidden = done >= total;
  el.replaceChildren(h('span', {}, `${label} ${done} / ${total}`), h('progress', { max: total, value: done }));
}

async function upload(files) {
  if (!files.length) return;
  let done = 0;
  const errors = [];
  progress(0, files.length, 'Import');
  await pool(files, 3, async (f) => {
    try {
      const p = await api.uploadPhoto(state.project.id, f);
      state.photos.set(p.id, p);
    } catch (e) {
      errors.push(`${f.name} : ${e.message}`);
    }
    progress(++done, files.length, 'Import');
  });
  state.trip = null;
  if (errors.length) toast(`${errors.length} fichier(s) refusé(s). ${errors[0]}`, 'error');
  if (container?.isConnected) refresh();
}

async function openImmich() {
  const body = h('div.immich', {}, h('p.muted', {}, 'Chargement des albums…'));
  const m = modal('Importer depuis Immich', body, { wide: true });
  try {
    const albums = await api.immichAlbums();
    body.replaceChildren(h('div.album-list', {}, albums.map((a) => h('button.album', { onclick: () => openAlbum(a, body, m) },
      a.thumbnail ? h('img', { src: api.immichThumb(a.thumbnail), alt: '' }) : h('div.noimg'),
      h('strong', {}, a.name || 'Sans titre'),
      h('span.muted', {}, `${a.count} éléments`)))));
  } catch (e) {
    body.replaceChildren(h('p.error', {}, e.message));
  }
}

async function openAlbum(album, body, m) {
  body.replaceChildren(h('p.muted', {}, 'Chargement de l’album…'));
  const assets = await api.immichAlbum(album.id);
  const already = new Set([...state.photos.values()].map((p) => p.immichId).filter(Boolean));
  const selected = new Set(assets.filter((a) => !already.has(a.id)).map((a) => a.id));
  const count = h('span');
  const updateCount = () => { count.textContent = `${selected.size} sélectionnée(s)`; };
  const grid = h('div.asset-grid', {}, assets.map((a) => {
    const cb = h('input', {
      type: 'checkbox', checked: selected.has(a.id), disabled: already.has(a.id), 'aria-label': a.name,
      onchange: (e) => { e.target.checked ? selected.add(a.id) : selected.delete(a.id); updateCount(); },
    });
    return h('label.asset', {}, h('img', { src: api.immichThumb(a.id), loading: 'lazy', alt: '' }), cb,
      h('span', {}, a.lat !== null ? (a.city || 'GPS') : 'sans GPS'));
  }));
  updateCount();
  const go = h('button.primary', {
    onclick: async () => {
      const ids = [...selected];
      m.close();
      let done = 0;
      const errors = [];
      progress(0, ids.length, 'Import Immich');
      await pool(ids, 2, async (id) => {
        try {
          const p = await api.immichImport(state.project.id, id);
          state.photos.set(p.id, p);
        } catch (e) {
          errors.push(e.message);
        }
        progress(++done, ids.length, 'Import Immich');
      });
      state.trip = null;
      if (errors.length) toast(`${errors.length} élément(s) non importé(s) : ${errors[0]}`, 'error');
      if (container?.isConnected) refresh();
    },
  }, 'Importer');
  body.replaceChildren(
    h('div.asset-toolbar', {}, h('strong', {}, album.name), count,
      h('button', { onclick: () => { assets.forEach((a) => !already.has(a.id) && selected.add(a.id)); grid.querySelectorAll('input:not(:disabled)').forEach((c) => { c.checked = true; }); updateCount(); } }, 'Tout'),
      h('button', { onclick: () => { selected.clear(); grid.querySelectorAll('input').forEach((c) => { c.checked = false; }); updateCount(); } }, 'Aucune'),
      go),
    grid);
}
