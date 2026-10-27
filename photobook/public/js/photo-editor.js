// Fenêtre de recadrage (Cropper.js) et de réglage luminosité / contraste.
import { api } from './api.js';
import { h, modal, toast, photoFilterCss } from './ui.js';
import { state } from './state.js';
import { fitRegion } from './book.js';

/**
 * @param photo   la photo à modifier
 * @param aspect  rapport largeur/hauteur de l'emplacement (null = libre)
 */
export function openPhotoEditor(photo, aspect, onSaved) {
  let brightness = photo.brightness || 0;
  let contrast = photo.contrast || 0;
  let cropper = null;
  const img = h('img', { src: api.previewUrl(state.project.id, photo.id), alt: '' });
  const applyPreview = () => {
    const css = photoFilterCss({ id: 'live', brightness, contrast });
    document.querySelectorAll('.editor-stage img').forEach((i) => { i.style.filter = css; });
  };
  const slider = (label, value, set) => {
    const out = h('output', {}, value);
    return h('label.field', {}, h('span', {}, label, ' ', out), h('input', {
      type: 'range', min: -100, max: 100, step: 1, value,
      oninput: (e) => { set(Number(e.target.value)); out.textContent = e.target.value; applyPreview(); },
    }));
  };
  const save = async () => {
    const d = cropper.getData(true);
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const crop = { x: d.x / nw, y: d.y / nh, w: d.width / nw, h: d.height / nh };
    try {
      const updated = await api.updatePhoto(state.project.id, photo.id, { crop, brightness, contrast });
      state.photos.set(updated.id, updated);
      m.close();
      onSaved?.(updated);
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const body = h('div.editor', {},
    h('div.editor-stage', {}, img),
    h('div.editor-side', {},
      h('p.muted.small', {}, aspect ? 'Le cadre a les proportions de l’emplacement choisi dans la page.' : 'Cadrage libre.'),
      slider('Luminosité', brightness, (v) => { brightness = v; }),
      slider('Contraste', contrast, (v) => { contrast = v; }),
      h('button', { onclick: () => { cropper.reset(); } }, 'Réinitialiser le cadrage'),
      h('div.grow'),
      h('button.primary', { onclick: save }, 'Enregistrer')));
  const m = modal(`Modifier « ${photo.name} »`, body, { wide: true, onClose: () => cropper?.destroy() });
  img.addEventListener('load', () => {
    cropper = new Cropper(img, {
      aspectRatio: aspect || NaN,
      viewMode: 1,
      autoCropArea: 1,
      background: false,
      ready() {
        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        // Point de départ : le cadrage existant, ramené aux proportions de l'emplacement.
        const r = aspect ? fitRegion(nw, nh, photo.crop, aspect)
          : (photo.crop ? { x: photo.crop.x * nw, y: photo.crop.y * nh, w: photo.crop.w * nw, h: photo.crop.h * nh } : null);
        if (r) cropper.setData({ x: r.x, y: r.y, width: r.w, height: r.h });
        applyPreview();
      },
    });
  }, { once: true });
}
