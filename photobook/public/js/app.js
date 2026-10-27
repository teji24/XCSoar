// Point d'entrée : liste des projets et coquille de l'éditeur (onglets Photos / Voyage / Livre).
import { api } from './api.js';
import { h, toast } from './ui.js';
import { state, flushSave, markDirty } from './state.js';
import * as photosView from './photos-view.js';
import * as tripView from './trip-view.js';
import * as bookView from './book-view.js';

const root = document.getElementById('app');
const views = { photos: photosView, trip: tripView, book: bookView };
let activeView = null;

async function boot() {
  try {
    state.config = await api.config();
  } catch (e) {
    root.replaceChildren(h('p.error-page', {}, `Le serveur ne répond pas : ${e.message}`));
    return;
  }
  window.addEventListener('hashchange', route);
  route();
}

async function route() {
  activeView?.destroy?.();
  activeView = null;
  const m = location.hash.match(/^#\/p\/([0-9a-f]{16})(?:\/(\w+))?/);
  if (!m) {
    await flushSave();
    state.project = null;
    return renderHome();
  }
  if (!state.project || state.project.id !== m[1]) {
    await flushSave();
    try {
      const doc = await api.project(m[1]);
      state.photos = new Map(doc.photos.map((p) => [p.id, p]));
      delete doc.photos;
      state.project = doc;
      state.trip = null;
    } catch (e) {
      toast(e.message, 'error');
      location.hash = '#/';
      return;
    }
  }
  renderProject(views[m[2]] ? m[2] : 'photos');
}

async function renderHome() {
  document.title = 'Livre photo de voyage';
  const list = h('div.project-list', {}, h('p.muted', {}, 'Chargement…'));
  const name = h('input', { type: 'text', placeholder: 'Nom du livre (ex. « Portugal 2026 »)', 'aria-label': 'Nom du livre' });
  const create = async (e) => {
    e.preventDefault();
    const p = await api.createProject(name.value);
    location.hash = `#/p/${p.id}/photos`;
  };
  root.replaceChildren(
    h('header.home-head', {},
      h('h1', {}, 'Livre photo de voyage'),
      h('p.muted', {}, 'Importez vos photos, laissez le site retracer votre voyage à partir des dates et des positions GPS, puis exportez un PDF prêt à imprimer.')),
    h('form.create', { onsubmit: create }, name, h('button.primary', { type: 'submit' }, 'Nouveau livre')),
    list,
  );
  const projects = await api.projects();
  list.replaceChildren(...(projects.length ? projects.map((p) => h('div.project-card', {},
    h('a', { href: `#/p/${p.id}/photos` }, h('strong', {}, p.name),
      h('span.muted', {}, `${p.photoCount} photo${p.photoCount > 1 ? 's' : ''} · modifié le ${new Date(p.updatedAt * 1000).toLocaleDateString('fr-FR')}`)),
    h('button.icon.danger', {
      title: 'Supprimer', 'aria-label': `Supprimer ${p.name}`,
      onclick: async () => {
        if (!confirm(`Supprimer « ${p.name} » et toutes ses photos ?`)) return;
        await api.deleteProject(p.id);
        renderHome();
      },
    }, '×'),
  )) : [h('p.muted', {}, 'Aucun livre pour l’instant.')]));
}

function renderProject(tab) {
  const p = state.project;
  document.title = `${p.name} — Livre photo`;
  const tabs = [['photos', '1. Photos'], ['trip', '2. Voyage'], ['book', '3. Livre']];
  const main = h('main.view');
  const exportBtn = h('button.primary', { onclick: () => exportPdf(exportBtn) }, 'Exporter en PDF');
  root.replaceChildren(
    h('header.topbar', {},
      h('a.back', { href: '#/', title: 'Mes livres' }, '←'),
      h('input.project-name', {
        value: p.name, 'aria-label': 'Nom du livre',
        oninput: (e) => { p.name = e.target.value; markDirty(); },
      }),
      h('nav.tabs', {}, tabs.map(([id, label]) => h(`a${id === tab ? '.active' : ''}`, { href: `#/p/${p.id}/${id}` }, label))),
      exportBtn),
    main,
  );
  activeView = views[tab];
  activeView.render(main);
}

async function exportPdf(btn) {
  if (!state.project.pages?.length) {
    toast('Le livre est vide : créez-le depuis l’onglet « Voyage ».', 'error');
    return;
  }
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Génération du PDF…';
  try {
    await flushSave();
    const res = await api.pdf(state.project.id);
    const blob = await res.blob();
    const a = h('a', { href: URL.createObjectURL(blob), download: `${state.project.name || 'livre'}.pdf` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    toast('PDF généré.');
  } catch (e) {
    toast(`Échec de la génération : ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

boot();
