// Ligne de résultat (recherche simple, recherche avancée) : jaquette, titre français, notes, ajout au carnet.
import { h, poster, scoreChips, toast, typeLabel } from '../ui.js';
import * as store from '../store.js';
import * as omdb from '../omdb.js';
import { openDetail } from './detail.js';

/**
 * r = aperçu { id, title, year, type, poster } ; ratings = notes (undefined = en cours de chargement) ;
 * frTitle = titre français s'il est connu ; extra = contenu ajouté sous les notes.
 */
export function resultCard(r, { ratings, frTitle, onAdded, extra } = {}) {
  const saved = store.findTitle(r.id);
  const add = async (e) => {
    e.stopPropagation();
    try {
      const full = await omdb.details(store.getState().apiKey, r.id);
      store.addTitles([frTitle ? { ...full, frTitle } : full]);
      toast(`« ${frTitle ?? full.title} » ajouté au carnet`, 'ok');
      onAdded?.();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return h('li.result', {},
    h('button.result-main', { type: 'button', onclick: () => openDetail({ ...r, frTitle }) },
      poster({ ...r, frTitle }, { width: 160 }),
      h('div.result-text', {},
        h('strong', {}, frTitle ?? r.title),
        h('span.muted', {}, [frTitle && frTitle !== r.title ? r.title : null, typeLabel(r.type), r.year].filter(Boolean).join(' · ')),
        ratings === undefined ? h('span.chips.pending', {}, 'notes…') : scoreChips(ratings) ?? h('span.muted.small', {}, 'pas encore noté'),
        extra ?? null)),
    saved
      ? h('span.added', { title: 'Déjà dans le carnet' }, saved.status === 'watched' ? '✓ Vu' : '✓ Carnet')
      : h('button.add', { type: 'button', 'aria-label': `Ajouter ${frTitle ?? r.title} au carnet`, onclick: add }, '+'));
}
