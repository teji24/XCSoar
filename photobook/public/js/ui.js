// Petits utilitaires d'interface.

/** Crée un élément : h('div.cls', {attrs}, enfants…). */
export function h(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function toast(message, kind = 'info') {
  let box = document.querySelector('.toasts');
  if (!box) {
    box = h('div.toasts');
    document.body.append(box);
  }
  const t = h(`div.toast.${kind}`, { role: 'status' }, message);
  box.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 8000 : 3500);
}

/** Fenêtre modale ; renvoie { el, close }. */
export function modal(title, body, { wide = false, onClose } = {}) {
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  const panel = h(`div.modal${wide ? '.wide' : ''}`, { role: 'dialog', 'aria-label': title },
    h('header', {}, h('h2', {}, title), h('button.icon', { onclick: close, title: 'Fermer', 'aria-label': 'Fermer' }, '×')),
    body);
  const overlay = h('div.overlay', { onmousedown: (e) => e.target === overlay && close() }, panel);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  return { el: panel, close };
}

export const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Exécute des tâches asynchrones avec une concurrence limitée. */
export async function pool(items, limit, worker) {
  let i = 0;
  const run = async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

/** Filtre SVG luminosité/contraste (même formule que ImageProcessor::adjust en PHP). */
export function adjustFilter(id, brightness, contrast) {
  const k = 1 + contrast / 100;
  const b = brightness / 200;
  const slope = k.toFixed(4);
  const intercept = ((b - 0.5) * k + 0.5).toFixed(4);
  const ns = 'http://www.w3.org/2000/svg';
  const filter = document.createElementNS(ns, 'filter');
  filter.setAttribute('id', id);
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  const fct = document.createElementNS(ns, 'feComponentTransfer');
  for (const c of ['R', 'G', 'B']) {
    const f = document.createElementNS(ns, `feFunc${c}`);
    f.setAttribute('type', 'linear');
    f.setAttribute('slope', slope);
    f.setAttribute('intercept', intercept);
    fct.append(f);
  }
  filter.append(fct);
  return filter;
}

/** Met à jour (ou crée) le filtre d'une photo et renvoie la valeur CSS à appliquer. */
export function photoFilterCss(photo) {
  if (!photo.brightness && !photo.contrast) return '';
  const id = `adj-${photo.id}-${photo.brightness}-${photo.contrast}`;
  const svg = document.getElementById('filters');
  if (!svg.querySelector(`#${CSS.escape(id)}`)) svg.append(adjustFilter(id, photo.brightness, photo.contrast));
  return `url(#${id})`;
}
