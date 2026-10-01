// Petits outils d'interface : création d'éléments sûre (pas d'innerHTML), feuilles, toasts, badges de notes.
import { posterUrl, rtState, TYPE_LABELS } from './model.js';

/** h('div.card', { onclick }, ...enfants) — le texte est toujours inséré comme texte. */
export function h(tag, props = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key in el && key !== 'list') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function toast(message, kind = 'info') {
  document.querySelectorAll('.toast').forEach((old) => old.remove());
  const el = h(`div.toast.${kind}`, { role: 'status' }, message);
  document.body.append(el);
  setTimeout(() => el.remove(), 2800);
}

/** Feuille plein écran (modale). `render(close)` renvoie le contenu. */
export function openSheet(title, render, { onClose, wide = false } = {}) {
  const previousFocus = document.activeElement;
  const close = () => {
    sheet.remove();
    document.body.classList.toggle('has-sheet', !!document.querySelector('.sheet'));
    onClose?.();
    previousFocus?.focus?.({ preventScroll: true });
  };
  const body = h('div.sheet-body');
  const sheet = h(
    `div.sheet${wide ? '.wide' : ''}`,
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header.sheet-head', {}, h('button.link', { type: 'button', onclick: close }, 'Fermer'), h('h2', {}, title), h('span')),
    body,
  );
  sheet.addEventListener('keydown', (e) => e.key === 'Escape' && close());
  document.body.append(sheet);
  document.body.classList.add('has-sheet');
  body.append(render(close));
  sheet.querySelector('.sheet-head button')?.focus?.({ preventScroll: true });
  return close;
}

const fmt1 = (n) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Petites pastilles de notes pour les cartes. */
export function scoreChips(ratings = {}, { compact = false } = {}) {
  const chips = [];
  if (ratings.imdb != null) chips.push(h('span.chip.imdb', { title: 'Note IMDb' }, h('b', {}, 'IMDb'), ` ${fmt1(ratings.imdb)}`));
  if (ratings.rt != null) {
    chips.push(h(`span.chip.rt.${rtState(ratings.rt)}`, { title: 'Rotten Tomatoes (critiques)' },
      h('i', { 'aria-hidden': 'true' }, rtState(ratings.rt) === 'fresh' ? '🍅' : '🟢'), ` ${ratings.rt} %`));
  }
  if (!compact && ratings.mc != null) chips.push(h('span.chip.mc', { title: 'Metacritic' }, h('b', {}, 'MC'), ` ${ratings.mc}`));
  return chips.length ? h('div.chips', {}, chips) : null;
}

/** Jaquette avec repli (titre écrit) si l'image manque ou ne charge pas. */
export function poster(title, { width = 300, eager = false } = {}) {
  const fallback = h('div.poster-fallback', { 'aria-hidden': 'true' }, h('span', {}, title.title), h('small', {}, title.year ?? ''));
  const src = posterUrl(title.poster, width);
  if (!src) return h('div.poster', {}, fallback);
  const img = h('img', {
    src, alt: `Affiche de ${title.title}`, loading: eager ? 'eager' : 'lazy', decoding: 'async', width: 300, height: 444,
    referrerPolicy: 'no-referrer',
    onerror: () => img.replaceWith(fallback),
  });
  return h('div.poster', {}, img);
}

export const typeLabel = (type) => TYPE_LABELS[type] ?? type ?? '';

export function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
