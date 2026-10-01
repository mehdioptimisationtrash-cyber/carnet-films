// Fiche d'un titre : jaquette, notes détaillées, infos, et actions du carnet.
import { h, openSheet, poster, toast, typeLabel } from '../ui.js';
import { formatRuntime, rtState, translateGenre } from '../model.js';
import * as store from '../store.js';
import * as omdb from '../omdb.js';

const fmt1 = (n) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const votes = (n) => (n ? `${n.toLocaleString('fr-FR')} votes` : null);

function scoreCard(label, value, sub, cls, href) {
  return h(`a.score.${cls}`, { href, target: '_blank', rel: 'noopener noreferrer' },
    h('span.score-label', {}, label),
    h('strong.score-value', {}, value ?? '—'),
    h('span.score-sub', {}, value == null ? 'pas de note' : sub ?? ''));
}

function scores(t) {
  const r = t.ratings ?? {};
  const q = encodeURIComponent(t.title);
  return h('div.scores', {},
    scoreCard('IMDb', r.imdb != null ? fmt1(r.imdb) : null, votes(r.imdbVotes) ?? '/ 10', 'imdb', `https://www.imdb.com/title/${t.id}/`),
    scoreCard('Rotten Tomatoes', r.rt != null ? `${r.rt} %` : null,
      r.rt == null ? null : rtState(r.rt) === 'fresh' ? '🍅 Frais (critiques)' : '🟢 Pourri (critiques)',
      `rt ${rtState(r.rt) ?? ''}`, `https://www.rottentomatoes.com/search?search=${q}`),
    scoreCard('Metacritic', r.mc != null ? String(r.mc) : null, '/ 100', 'mc', `https://www.metacritic.com/search/${q}/`));
}

function facts(t) {
  const rows = [
    ['Genre', t.genres?.map(translateGenre).join(', ')],
    ['Durée', t.type === 'series' ? (t.runtime ? `${t.runtime} min / épisode` : null) : formatRuntime(t.runtime)],
    ['Saisons', t.seasons],
    ['Réalisation', t.director],
    ['Scénario', t.writer],
    ['Avec', t.actors],
    ['Pays', t.country],
    ['Langue', t.language],
    ['Public', t.rated],
    ['Récompenses', t.awards],
  ].filter(([, v]) => v != null && v !== '');
  return h('dl.facts', {}, rows.map(([k, v]) => [h('dt', {}, k), h('dd', {}, String(v))]));
}

function stars(id, value) {
  const wrap = h('div.stars', { role: 'radiogroup', 'aria-label': 'Ma note sur 5' });
  for (let n = 1; n <= 5; n++) {
    wrap.append(h(`button.star${value >= n ? '.on' : ''}`, {
      type: 'button', role: 'radio', 'aria-checked': String(value === n), 'aria-label': `${n} sur 5`,
      onclick: () => store.patchTitle(id, { myRating: value === n ? null : n }),
    }, '★'));
  }
  return wrap;
}

function personal(t) {
  const watched = t.status === 'watched';
  return h('section.personal', {},
    h('div.actions', {},
      h(`button.btn${watched ? '.ghost' : '.primary'}`, { type: 'button', onclick: () => store.toggleWatched(t.id) },
        watched ? '↺ Remettre « à voir »' : '✓ Marquer comme vu'),
      h(`button.btn.ghost${t.priority ? '.on' : ''}`, {
        type: 'button', 'aria-pressed': String(!!t.priority),
        onclick: () => store.patchTitle(t.id, { priority: !t.priority }),
      }, t.priority ? '🔥 Prioritaire' : '☆ Prioritaire')),
    h('label.field', {}, h('span', {}, watched ? 'Ma note' : 'Ma note (après visionnage)'), stars(t.id, t.myRating)),
    h('label.field', {}, h('span', {}, 'Mon commentaire / qui me l’a conseillé'),
      h('textarea', {
        rows: 3, value: t.note ?? '', placeholder: 'Ex. conseillé par Julie, à voir en VO…',
        oninput: (e) => store.patchTitle(t.id, { note: e.target.value }, { quiet: true }),
      })),
    watched && t.watchedAt ? h('p.muted', {}, `Vu le ${new Date(t.watchedAt).toLocaleDateString('fr-FR', { dateStyle: 'long' })}`) : null);
}

function render(t, close) {
  const inCarnet = !!store.findTitle(t.id);
  const shown = store.findTitle(t.id) ?? t;
  const meta = [typeLabel(shown.type), shown.year, shown.type !== 'series' ? formatRuntime(shown.runtime) : null].filter(Boolean).join(' · ');
  return h('article.detail', {},
    h('div.detail-hero', {},
      poster(shown, { width: 600, eager: true }),
      h('div.detail-head', {},
        h('h3.detail-title', {}, shown.title),
        h('p.detail-meta', {}, meta),
        inCarnet
          ? h('p.in-carnet', {}, shown.status === 'watched' ? '✓ Vu — dans ton carnet' : '● Dans ton carnet — à voir')
          : h('button.btn.primary', {
            type: 'button',
            onclick: () => { store.addTitles([t]); toast(`« ${t.title} » ajouté au carnet`); },
          }, '+ Ajouter au carnet'))),
    scores(shown),
    shown.plot ? h('p.plot', { lang: 'en' }, shown.plot) : null,
    inCarnet ? personal(shown) : null,
    facts(shown),
    h('footer.detail-foot', {},
      inCarnet ? h('button.link', { type: 'button', onclick: () => refresh(shown.id) }, '↻ Actualiser les notes') : null,
      inCarnet ? h('button.link.danger', {
        type: 'button',
        onclick: () => {
          if (!confirm(`Retirer « ${shown.title} » du carnet ?`)) return;
          store.removeTitle(shown.id);
          close();
          toast('Retiré du carnet');
        },
      }, 'Retirer du carnet') : null,
      h('span.muted', {}, shown.fetchedAt ? `Notes du ${new Date(shown.fetchedAt).toLocaleDateString('fr-FR')}` : '')));
}

async function refresh(id) {
  try {
    store.refreshTitle(await omdb.details(store.getState().apiKey, id, { fresh: true }));
    toast('Notes à jour', 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

/** Ouvre la fiche. `preview` = aperçu de recherche ou titre du carnet ; la fiche complète est chargée si besoin. */
export function openDetail(preview) {
  let current = store.findTitle(preview.id) ?? preview;
  openSheet(current.title, (close) => {
    const host = h('div.detail-host');
    const draw = () => host.replaceChildren(render(store.findTitle(current.id) ?? current, close));
    const unsubscribe = store.subscribe((_, meta) => !meta.quiet && host.isConnected && draw());
    const observer = new MutationObserver(() => { if (!host.isConnected) { unsubscribe(); observer.disconnect(); } });
    observer.observe(document.body, { childList: true });
    draw();
    if (!current.fetchedAt) {
      host.classList.add('loading');
      omdb.details(store.getState().apiKey, current.id)
        .then((full) => { current = full; draw(); })
        .catch((err) => toast(err.message, 'error'))
        .finally(() => host.classList.remove('loading'));
    }
    return host;
  }, { wide: true });
}
