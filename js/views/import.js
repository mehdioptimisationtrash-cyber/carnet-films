// Importer une liste : un titre par ligne → chaque titre est retrouvé sur OMDb, vérifié, puis ajouté au carnet.
import { h, openSheet, poster, scoreChips, toast, typeLabel } from '../ui.js';
import { parseList, parseLine } from '../model.js';
import * as store from '../store.js';
import * as omdb from '../omdb.js';

const AT_ONCE = 3;
const MAX_LINES = 200;
const EXAMPLE = 'Inception\nLe Parrain (1972)\nThe Bear\n- Dune 2021\nhttps://www.imdb.com/title/tt0111161/';

function row(item, onRetry, onToggle) {
  const { state, title, error } = item;
  if (state === 'pending') return h('li.imp.pending', {}, h('span.imp-q', {}, item.raw), h('span.muted', {}, 'recherche…'));
  if (state === 'missing') {
    const retry = h('input', { type: 'text', value: item.query ?? item.raw, 'aria-label': `Autre titre pour ${item.raw}` });
    return h('li.imp.missing', {},
      h('div', {}, h('span.imp-q', {}, item.raw), h('span.bad', {}, error ?? 'introuvable')),
      h('form.imp-retry', { onsubmit: (e) => { e.preventDefault(); onRetry(retry.value); } },
        retry, h('button.btn.ghost', { type: 'submit' }, 'Réessayer')));
  }
  const known = store.findTitle(title.id);
  return h(`li.imp.found${item.checked ? '' : '.off'}`, {},
    h('label.imp-pick', {},
      h('input', { type: 'checkbox', checked: item.checked, disabled: !!known, onchange: (e) => onToggle(e.target.checked) }),
      poster(title, { width: 120 }),
      h('div.imp-text', {},
        h('strong', {}, title.title),
        h('span.muted', {}, [typeLabel(title.type), title.year].filter(Boolean).join(' · ')),
        scoreChips(title.ratings, { compact: true }),
        known ? h('span.muted.small', {}, 'déjà dans le carnet') : null,
        item.query && title.title.toLowerCase() !== item.query.toLowerCase()
          ? h('span.muted.small', {}, `pour « ${item.raw} »`) : null)));
}

function body(close) {
  const { apiKey } = store.getState();
  let items = [];
  const textarea = h('textarea.import-text', {
    rows: 8, placeholder: EXAMPLE, 'aria-label': 'Ta liste, un titre par ligne', spellcheck: false,
  });
  const list = h('ul.imp-list');
  const status = h('p.status.muted', { role: 'status' });
  const confirmBtn = h('button.btn.primary.wide', { type: 'button', hidden: true, onclick: commit }, '');

  const setItem = (index, changes) => {
    items = items.map((it, i) => (i === index ? { ...it, ...changes } : it));
    draw();
  };

  function draw() {
    list.replaceChildren(...items.map((it, i) => row(
      it,
      (text) => lookup(i, parseLine(text) ?? { ...it, query: text, year: null, imdbId: null }),
      (checked) => setItem(i, { checked }),
    )));
    const ready = chosen().filter((t) => !store.findTitle(t.id));
    const pending = items.filter((it) => it.state === 'pending').length;
    const missing = items.filter((it) => it.state === 'missing').length;
    status.textContent = items.length
      ? `${items.length - pending - missing} trouvé${items.length - pending - missing > 1 ? 's' : ''}`
        + (missing ? ` · ${missing} introuvable${missing > 1 ? 's' : ''} (corrige le titre et réessaie)` : '')
        + (pending ? ` · ${pending} en cours…` : '')
      : '';
    confirmBtn.hidden = !ready.length;
    confirmBtn.textContent = `Ajouter ${ready.length} titre${ready.length > 1 ? 's' : ''} au carnet`;
  }

  async function lookup(index, parsed) {
    setItem(index, { ...parsed, state: 'pending' });
    try {
      const title = await omdb.resolve(apiKey, parsed);
      setItem(index, title ? { state: 'found', title, checked: true } : { state: 'missing', error: 'introuvable' });
    } catch (err) {
      setItem(index, { state: 'missing', error: err.message });
    }
  }

  async function analyse() {
    const parsed = parseList(textarea.value).slice(0, MAX_LINES);
    if (!parsed.length) { toast('Colle au moins un titre.'); return; }
    items = parsed.map((p) => ({ ...p, state: 'pending' }));
    draw();
    await omdb.pool(parsed, AT_ONCE, (p) => omdb.resolve(apiKey, p), (i, res) => {
      if (res.ok && res.value) setItem(i, { state: 'found', title: res.value, checked: true });
      else setItem(i, { state: 'missing', error: res.ok ? 'introuvable' : res.error.message });
    });
    // Les lignes non traitées (clé refusée, limite du jour) restent signalées.
    items = items.map((it) => (it.state === 'pending' ? { ...it, state: 'missing', error: 'non traité' } : it));
    draw();
  }

  /** Titres cochés, sans doublon (deux lignes peuvent mener au même titre). */
  function chosen() {
    const byId = new Map(items.filter((it) => it.state === 'found' && it.checked).map((it) => [it.title.id, it.title]));
    return [...byId.values()];
  }

  function commit() {
    const added = store.addTitles(chosen());
    toast(`${added} titre${added > 1 ? 's' : ''} ajouté${added > 1 ? 's' : ''} au carnet`, 'ok');
    close();
  }

  return h('div.import', {},
    h('p.muted', {},
      'Un titre par ligne. Tu peux ajouter l’année — « Dune (2021) » — ou coller un lien IMDb pour être sûr du bon titre. ',
      'Les titres en anglais (titre original) sont mieux reconnus.'),
    textarea,
    h('button.btn.primary.wide', { type: 'button', onclick: analyse }, 'Rechercher ces titres'),
    status, list, confirmBtn);
}

export const openImport = () => openSheet('Importer une liste', body, { wide: true });
