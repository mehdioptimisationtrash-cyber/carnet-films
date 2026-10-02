// Onglet « Pour moi » : je donne mes coups de cœur, l'app trouve ce qui les relie et propose des titres expliqués.
// Chaque réponse (« à voir », « déjà vu » + étoiles, « pas pour moi ») et chaque note du carnet affine le profil.
import { h, poster, scoreChips, toast, typeLabel } from '../ui.js';
import { displayTitle, formatRuntime } from '../model.js';
import * as store from '../store.js';
import * as omdb from '../omdb.js';
import { findByFrenchTitle, frenchTitles } from '../french.js';
import { analyse, lovedTitles, MIN_LOVED, suggest } from '../recommend.js';
import { openDetail } from './detail.js';

// Gardé entre deux affichages de l'onglet.
let memo = { analysis: null, suggestions: null, type: '', busy: false, progress: '', error: '', basis: '' };
const basisOf = (state) => JSON.stringify([state.titles.map((t) => [t.id, t.myRating, t.status]), state.dismissed]);

// ——— 1. Mes coups de cœur ———

async function addLoved(preview, rating) {
  const { apiKey } = store.getState();
  try {
    const known = store.findTitle(preview.id);
    if (known) store.patchTitle(preview.id, { myRating: rating, status: 'watched', watchedAt: known.watchedAt ?? Date.now() });
    else {
      const fiche = await omdb.details(apiKey, preview.id);
      store.addTitles([preview.frTitle ? { ...fiche, frTitle: preview.frTitle } : fiche], { status: 'watched', myRating: rating, watchedAt: Date.now() });
    }
    toast(`${rating === 5 ? '❤❤ Adoré' : '❤ Aimé'} : ${preview.frTitle ?? preview.title}`, 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function lovedPicker() {
  const results = h('ul.love-results');
  const status = h('p.status.muted', { role: 'status' });
  const input = h('input', { type: 'search', placeholder: 'Un film ou une série que tu as aimé…', autocomplete: 'off', 'aria-label': 'Titre aimé' });
  let token = 0;
  const search = async (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (query.length < 2) return;
    const myToken = ++token;
    status.textContent = 'Recherche…';
    const { apiKey } = store.getState();
    try {
      const [byTitle, frIds] = await Promise.all([
        omdb.search(apiKey, query).then((r) => r.results).catch(() => []),
        findByFrenchTitle(query, { limit: 3 }).catch(() => []),
      ]);
      const extra = await Promise.all(frIds.filter((id) => !byTitle.some((r) => r.id === id)).map((id) => omdb.details(apiKey, id).catch(() => null)));
      const all = [...extra.filter(Boolean), ...byTitle].filter((r) => r.type === 'movie' || r.type === 'series').slice(0, 6);
      const fr = await frenchTitles(all.map((r) => r.id));
      if (myToken !== token) return;
      status.textContent = all.length ? '' : 'Rien trouvé : essaie le titre original.';
      results.replaceChildren(...all.map((r) => {
        const preview = { id: r.id, title: r.title, year: r.year, type: r.type, poster: r.poster, frTitle: fr[r.id] };
        return h('li.love-row', {},
          poster(preview, { width: 120 }),
          h('div', {}, h('strong', {}, preview.frTitle ?? r.title), h('span.muted.small', {}, [typeLabel(r.type), r.year].filter(Boolean).join(' · '))),
          h('div.love-actions', {},
            h('button.btn.ghost', { type: 'button', onclick: () => addLoved(preview, 4) }, '❤ Aimé'),
            h('button.btn.primary', { type: 'button', onclick: () => addLoved(preview, 5) }, '❤❤ Adoré')));
      }));
    } catch (err) {
      status.textContent = err.message;
    }
  };
  return h('div.love-picker', {}, h('form.love-search', { onsubmit: search }, input, h('button.btn.ghost', { type: 'submit' }, 'Chercher')), status, results);
}

function lovedSection(state) {
  const loved = lovedTitles(state);
  const missing = Math.max(0, MIN_LOVED - loved.length);
  return h('section.disc-block', {},
    h('h2', {}, 'Tes coups de cœur'),
    h('p.muted', {}, missing
      ? `Donne-moi au moins ${MIN_LOVED} films ou séries que tu as aimés (5 ou plus, c’est encore mieux). Encore ${missing}.`
      : 'Ajoute-en d’autres quand tu veux : plus il y en a, plus les suggestions sont justes. Les étoiles que tu mets dans le carnet comptent aussi.'),
    loved.length ? h('ul.loved', {}, loved.map((t) => h('li', {},
      h('button.loved-chip', { type: 'button', onclick: () => openDetail(t), title: 'Ouvrir la fiche' },
        poster(t, { width: 120 }), h('span', {}, displayTitle(t)), h('b', {}, t.myRating === 5 ? '❤❤' : '❤'))))) : null,
    lovedPicker());
}

// ——— 2. Ce qui relie mes goûts ———

function linksSection(analysis) {
  if (!analysis) return null;
  const { links, decades, unknown } = analysis;
  if (!links.length && !decades.length) {
    return h('section.disc-block', {}, h('h2', {}, 'Ce qui relie tes goûts'),
      h('p.muted', {}, 'Pas encore de point commun net entre tes coups de cœur : les suggestions s’appuient sur chacun séparément.'));
  }
  return h('section.disc-block', {},
    h('h2', {}, 'Ce qui relie tes goûts'),
    h('ul.links', {},
      links.map((l) => h('li', {},
        h('span.link-role', {}, l.rolesText),
        h('strong', {}, l.label),
        h('span.muted.small', {}, l.liked.join(', ')))),
      decades.map((d) => h('li', {}, h('span.link-role', {}, 'Époque'), h('strong', {}, `Années ${d.decade}`), h('span.muted.small', {}, `${d.count} de tes coups de cœur`)))),
    unknown.length ? h('p.muted.small', {}, `Peu d’informations sur : ${unknown.join(', ')}.`) : null);
}

// ——— 3. Suggestions ———

function stars(onPick) {
  return h('div.stars.inline', { role: 'group', 'aria-label': 'Ma note' },
    [1, 2, 3, 4, 5].map((n) => h('button.star', { type: 'button', 'aria-label': `${n} sur 5`, onclick: () => onPick(n) }, '★')));
}

function suggestionCard(s, remove) {
  const f = s.fiche;
  const name = f.frTitle ?? f.title;
  const actions = h('div.sugg-actions');
  const reset = () => actions.replaceChildren(
    h('button.btn.primary', {
      type: 'button',
      onclick: () => { store.addTitles([f]); toast(`« ${name} » ajouté à voir`, 'ok'); remove(); },
    }, '+ À voir'),
    h('button.btn.ghost', {
      type: 'button',
      onclick: () => actions.replaceChildren(h('span.muted.small', {}, 'Ta note :'), stars((n) => {
        store.addTitles([f], { status: 'watched', myRating: n, watchedAt: Date.now() });
        toast(n >= 4 ? 'Noté — je retiens que tu as aimé' : 'Noté — je retiens que ce n’était pas pour toi', 'ok');
        remove();
      }), h('button.link', { type: 'button', onclick: reset }, 'Annuler')),
    }, 'Déjà vu'),
    h('button.link.danger', { type: 'button', onclick: () => { store.dismiss(f.id); toast('Écarté — je propose moins ce genre de titres'); remove(); } }, 'Pas pour moi'));
  reset();
  return h('li.sugg', {},
    h('button.sugg-poster', { type: 'button', onclick: () => openDetail(f), 'aria-label': `Fiche de ${name}` }, poster(f, { width: 300 })),
    h('div.sugg-body', {},
      h('h3', {}, h('button.link.title-link', { type: 'button', onclick: () => openDetail(f) }, name)),
      h('p.muted.small', {}, [name !== f.title ? f.title : null, typeLabel(f.type), f.year, f.type === 'movie' ? formatRuntime(f.runtime) : null].filter(Boolean).join(' · ')),
      scoreChips(f.ratings),
      h('ul.why', {}, s.why.map((w) => h('li', {}, w))),
      actions));
}

function suggestionsSection(paint) {
  const { suggestions } = memo;
  if (!suggestions) return null;
  const list = h('ul.suggs');
  const fill = () => {
    const visible = memo.suggestions.filter((s) => !store.findTitle(s.fiche.id) && !store.getState().dismissed?.includes(s.fiche.id));
    list.replaceChildren(...visible.map((s) => suggestionCard(s, () => {
      memo = { ...memo, suggestions: memo.suggestions.filter((x) => x !== s) };
      fill();
    })));
    if (!visible.length) list.replaceChildren(h('li.empty', {}, 'Plus de suggestions dans cette série. Recalcule pour en avoir d’autres.'));
  };
  fill();
  return h('section.disc-block', {},
    h('div.disc-head', {},
      h('h2', {}, 'Suggestions pour toi'),
      h('div.segmented', { role: 'radiogroup', 'aria-label': 'Type' },
        [['', 'Les deux'], ['movie', 'Films'], ['series', 'Séries']].map(([v, l]) => h(`button${memo.type === v ? '.on' : ''}`, {
          type: 'button', role: 'radio', 'aria-checked': String(memo.type === v),
          onclick: () => { memo = { ...memo, type: v }; compute(paint); },
        }, l)))),
    list);
}

async function compute(paint) {
  const state = store.getState();
  memo = { ...memo, busy: true, error: '', progress: 'Analyse de tes goûts…' };
  paint();
  try {
    const analysis = await analyse(state);
    memo = { ...memo, analysis };
    paint();
    const suggestions = await suggest(analysis, store.getState(), {
      type: memo.type,
      onProgress: (progress) => { memo = { ...memo, progress }; paint({ progressOnly: true }); },
    });
    memo = { ...memo, suggestions, basis: basisOf(store.getState()) };
  } catch (err) {
    console.error('Suggestions impossibles', err);
    memo = { ...memo, error: err.code ? err.message : 'Wikidata ne répond pas pour l’instant. Réessaie dans une minute.' };
  } finally {
    memo = { ...memo, busy: false, progress: '' };
    paint();
  }
}

export function renderDiscover(root) {
  let progressEl = null;
  const paint = ({ progressOnly = false } = {}) => {
    if (!root.isConnected) return;
    if (progressOnly && progressEl?.isConnected) { progressEl.textContent = memo.progress; return; }
    const state = store.getState();
    const enough = lovedTitles(state).length >= MIN_LOVED;
    const stale = memo.suggestions && memo.basis !== basisOf(state);
    progressEl = h('p.status.muted', { role: 'status' }, memo.progress);
    const cta = h(`button.btn.primary.wide${memo.busy ? '.busy' : ''}`, {
      type: 'button', disabled: !enough || memo.busy, onclick: () => compute(paint),
    }, memo.busy ? 'Je cherche…' : memo.suggestions ? (stale ? '↻ Recalculer avec mes nouveaux avis' : '↻ Recalculer') : 'Trouver mes suggestions');
    root.replaceChildren(
      h('header.page-head', {},
        h('p.kicker', {}, 'Pour moi'),
        h('h1', {}, 'Suggestions sur mesure'),
        h('p.muted', {}, 'Je cherche ce qui relie tes coups de cœur (réalisateurs, acteurs, scénaristes, thèmes, genres) et je te propose des titres qui partagent ces liens, en t’expliquant pourquoi.')),
      lovedSection(state),
      h('div.disc-cta', {}, cta, progressEl, memo.error ? h('p.bad', {}, memo.error) : null),
      linksSection(memo.analysis),
      suggestionsSection(paint));
  };
  paint();
}

