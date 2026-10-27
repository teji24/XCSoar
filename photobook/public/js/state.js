// État partagé de l'application et sauvegarde automatique du projet.
import { api } from './api.js';
import { pageSize } from './book.js';
import { toast } from './ui.js';

export const state = {
  config: null,
  project: null,
  photos: new Map(),
  trip: null, // { items, hierarchy, positions } recalculé à la demande
};

export const photosSorted = () => [...state.photos.values()].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0) || (a.id < b.id ? -1 : 1));

export const currentPage = () => pageSize(state.project.format, state.config.formats);

let timer = null;
let dirty = false;
let pending = Promise.resolve();
let version = 0;

/** Version du dernier état enregistré : sert à invalider les aperçus de cartes. */
export const savedVersion = () => version;

export function markDirty() {
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(flushSave, 700);
}

export function flushSave() {
  clearTimeout(timer);
  if (!dirty || !state.project) return pending;
  dirty = false;
  const doc = JSON.parse(JSON.stringify(state.project));
  pending = pending
    .then(() => api.saveProject(doc.id, doc))
    .then(() => { version++; })
    .catch((e) => {
      dirty = true;
      toast(`Sauvegarde impossible : ${e.message}`, 'error');
    });
  return pending;
}

window.addEventListener('beforeunload', (e) => {
  if (dirty) {
    flushSave();
    e.preventDefault();
  }
});
