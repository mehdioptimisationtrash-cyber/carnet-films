// Réglages : clé OMDb (avec accueil pas à pas), actualisation des notes, sauvegarde fichier.
import { download, h, openSheet, readFile, toast } from '../ui.js';
import * as store from '../store.js';
import * as omdb from '../omdb.js';
import { APP_VERSION } from '../version.js';

const SIGNUP_URL = 'https://www.omdbapi.com/apikey.aspx';
const REFRESH_AT_ONCE = 3;

/** Formulaire de clé, utilisé à l'accueil et dans Réglages. */
export function keyForm({ onSaved } = {}) {
  const input = h('input', {
    type: 'text', value: store.getState().apiKey, placeholder: 'ex. 1a2b3c4d', autocomplete: 'off',
    autocapitalize: 'off', spellcheck: false, 'aria-label': 'Clé OMDb', inputMode: 'text',
  });
  const status = h('p.status', { role: 'status' });
  const submit = h('button.btn.primary', { type: 'submit' }, 'Vérifier et enregistrer');
  return h('form.key-form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const key = input.value.trim();
      if (!/^[a-z0-9]{6,12}$/i.test(key)) { status.textContent = 'La clé fait 8 caractères (lettres et chiffres).'; return; }
      submit.disabled = true;
      status.textContent = 'Vérification…';
      try {
        await omdb.checkKey(key);
        store.setApiKey(key);
        status.textContent = '✓ Clé valide';
        onSaved?.();
      } catch (err) {
        status.textContent = err.code === 'key'
          ? 'Clé refusée. As-tu cliqué sur le lien d’activation reçu par e-mail ?'
          : err.message;
      } finally {
        submit.disabled = false;
      }
    },
  }, h('div.key-row', {}, input, submit), status);
}

export function renderWelcome(root, onDone) {
  root.replaceChildren(h('section.welcome', {},
    h('p.kicker', {}, 'Bienvenue'),
    h('h1', {}, 'Carnet Films'),
    h('p.lead', {}, 'Ta watchlist avec les jaquettes et les notes IMDb, Rotten Tomatoes et Metacritic.'),
    h('div.steps', {},
      h('h2', {}, 'Une seule étape avant de commencer'),
      h('p', {}, 'Les notes viennent d’OMDb, un service gratuit. Il te donne une « clé » (un petit code) à coller ici :'),
      h('ol', {},
        h('li', {}, 'Ouvre ', h('a', { href: SIGNUP_URL, target: '_blank', rel: 'noopener' }, 'omdbapi.com/apikey.aspx'),
          ', choisis « FREE », mets ton e-mail, ton prénom et une phrase (« usage perso »).'),
        h('li', {}, 'Ouvre l’e-mail reçu et clique sur le lien d’activation.'),
        h('li', {}, 'Copie la clé (8 caractères) de l’e-mail et colle-la ci-dessous.')),
      keyForm({ onSaved: onDone }),
      h('p.muted.small', {}, 'Gratuit, 1 000 demandes par jour : largement assez. La clé reste sur ton téléphone.'))));
}

async function refreshAll(button) {
  const { apiKey, titles } = store.getState();
  if (!titles.length) { toast('Le carnet est vide.'); return; }
  button.disabled = true;
  let done = 0;
  let failed = 0;
  await omdb.pool(titles, REFRESH_AT_ONCE, (t) => omdb.details(apiKey, t.id, { fresh: true }), (_, res) => {
    done += 1;
    if (res.ok) store.refreshTitle(res.value);
    else failed += 1;
    button.textContent = `Actualisation… ${done}/${titles.length}`;
  });
  button.disabled = false;
  button.textContent = 'Actualiser toutes les notes';
  toast(failed ? `${titles.length - failed} à jour, ${failed} en échec` : 'Toutes les notes sont à jour', failed ? 'error' : 'ok');
}

function body() {
  const refreshBtn = h('button.btn.ghost', { type: 'button', onclick: () => refreshAll(refreshBtn) }, 'Actualiser toutes les notes');
  const fileInput = h('input', {
    type: 'file', accept: 'application/json,.json', hidden: true,
    onchange: async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const n = store.importJson(await readFile(file));
        toast(`${n} titre${n > 1 ? 's' : ''} restauré${n > 1 ? 's' : ''}`, 'ok');
      } catch (err) {
        toast(`Fichier illisible : ${err.message}`, 'error');
      }
      e.target.value = '';
    },
  });
  const { titles } = store.getState();
  return h('div.settings', {},
    h('section.card-block', {},
      h('h3', {}, 'Clé OMDb'),
      h('p.muted.small', {}, 'Elle sert à chercher les titres et à récupérer les notes. ',
        h('a', { href: SIGNUP_URL, target: '_blank', rel: 'noopener' }, 'Obtenir une clé gratuite')),
      keyForm({ onSaved: () => toast('Clé enregistrée', 'ok') })),
    h('section.card-block', {},
      h('h3', {}, 'Notes'),
      h('p.muted.small', {}, 'Les notes évoluent avec le temps. Ceci recharge celles des ', String(titles.length), ' titres du carnet.'),
      refreshBtn),
    h('section.card-block', {},
      h('h3', {}, 'Sauvegarde'),
      h('p.muted.small', {}, 'Le carnet est enregistré sur ce téléphone. Fais une copie de temps en temps (dans Fichiers ou iCloud).'),
      h('div.actions', {},
        h('button.btn.ghost', {
          type: 'button',
          onclick: () => download(`carnet-films-${new Date().toISOString().slice(0, 10)}.json`, store.exportJson()),
        }, 'Enregistrer une copie'),
        h('button.btn.ghost', { type: 'button', onclick: () => fileInput.click() }, 'Restaurer une copie'),
        fileInput)),
    h('p.muted.small.center', {}, `Carnet Films — version ${APP_VERSION} · données OMDb (IMDb, Rotten Tomatoes, Metacritic)`));
}

export const openSettings = () => openSheet('Réglages', body);
