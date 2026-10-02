// Branchement de la sauvegarde en ligne (Google Sheets) : pas à pas, avec le script prêt à coller.
import { h, toast } from '../ui.js';
import * as sync from '../sync.js';

const PENDING_TOKEN_KEY = 'carnet-films:pending-token';
const SCRIPT_PLACEHOLDER = 'COLLE_ICI_TON_CODE_SECRET';

function pendingToken() {
  try {
    let token = localStorage.getItem(PENDING_TOKEN_KEY);
    if (!token) { token = sync.newToken(); localStorage.setItem(PENDING_TOKEN_KEY, token); }
    return token;
  } catch {
    return sync.newToken();
  }
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function connectForm({ token = '', onDone, submitLabel = 'Brancher la feuille' }) {
  const noAuto = { autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: false };
  const url = h('input', { type: 'text', inputMode: 'url', placeholder: 'https://script.google.com/macros/s/…/exec', ...noAuto, 'aria-label': 'Adresse du script' });
  const code = h('input', { type: 'text', value: token, placeholder: 'code secret', ...noAuto, 'aria-label': 'Code secret' });
  const status = h('p.status', { role: 'status' });
  const submit = h('button.btn.primary', { type: 'submit' }, submitLabel);
  return h('form.cloud-form', {
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      status.textContent = 'Connexion à ta feuille…';
      try {
        const n = await sync.connect(url.value, code.value);
        status.textContent = '';
        toast(n ? `Feuille branchée — ${n} titre${n > 1 ? 's' : ''} récupéré${n > 1 ? 's' : ''}` : 'Feuille branchée', 'ok');
        onDone?.();
      } catch (err) {
        status.textContent = err.message;
      } finally {
        submit.disabled = false;
      }
    },
  },
  h('label.field', {}, h('span', {}, 'Adresse du script (…/exec)'), url),
  h('label.field', {}, h('span', {}, 'Code secret'), code),
  submit, status);
}

/** Mise en place pas à pas : feuille vide → script (code déjà dedans) → déploiement → adresse. */
function setup(onDone) {
  const token = pendingToken();
  let script = null;
  // Le script est préparé à l'avance : sur iPhone, la copie doit se faire tout de suite après le toucher.
  fetch('apps-script/Code.gs').then((r) => r.text()).then((text) => { script = text.replace(SCRIPT_PLACEHOLDER, token); });
  const fallback = h('textarea.script-text', { rows: 6, readOnly: true, hidden: true, 'aria-label': 'Script à copier' });
  const copyBtn = h('button.btn.ghost', {
    type: 'button',
    onclick: async () => {
      if (!script) { toast('Script en cours de chargement, réessaie dans une seconde'); return; }
      if (await copy(script)) toast('Script copié ✓', 'ok');
      else { fallback.value = script; fallback.hidden = false; fallback.select(); toast('Sélectionne le texte ci-dessous et copie-le'); }
    },
  }, '📋 Copier le script');
  return h('div.cloud-setup', {},
    h('ol.steps-list', {},
      h('li', {}, 'Crée une feuille Google vide : ', h('a', { href: 'https://sheets.new', target: '_blank', rel: 'noopener' }, 'sheets.new'),
        ' (nomme-la « Carnet Films »).'),
      h('li', {}, 'Dans la feuille : ', h('b', {}, 'Extensions → Apps Script'), '. Efface tout le texte, puis colle le script :',
        h('div.actions', {}, copyBtn), fallback,
        h('p.muted.small', {}, 'Ton code secret est déjà dedans : ', h('code', {}, token))),
      h('li', {}, 'Clique ', h('b', {}, 'Déployer → Nouveau déploiement'), ', choisis le type ', h('b', {}, 'Application web'),
        ', « Exécuter en tant que : Moi » et ', h('b', {}, '« Qui a accès : Tout le monde »'), '. Autorise l’accès quand Google le demande.'),
      h('li', {}, 'Copie l’adresse qui finit par ', h('code', {}, '/exec'), ' et colle-la ici :')),
    connectForm({ token, onDone: () => { try { localStorage.removeItem(PENDING_TOKEN_KEY); } catch { /* rien */ } onDone?.(); } }));
}

/** Bloc « Sauvegarde en ligne » des Réglages. */
export function cloudCard() {
  const card = h('section.card-block.cloud');
  const paint = () => {
    if (!sync.isEnabled()) {
      card.replaceChildren(
        h('h3', {}, 'Sauvegarde en ligne'),
        h('p.warn', {}, '⚠ Pour l’instant, ton carnet n’est que sur cet appareil.'),
        h('p.muted.small', {}, 'Branche une feuille Google Sheets : le carnet y est enregistré à chaque changement, relu à chaque ouverture, et tu le retrouves sur n’importe quel appareil (téléphone, ordinateur).'),
        setup(paint),
        h('details.small', {}, h('summary', {}, 'J’ai déjà une feuille Carnet Films'), connectForm({ onDone: paint })));
      return;
    }
    const label = h('p.cloud-status', { role: 'status' }, sync.getStatus().label);
    const off = sync.onStatus((s) => { if (!label.isConnected) { off(); return; } label.textContent = s.label; label.dataset.state = s.state; });
    label.dataset.state = sync.getStatus().state;
    card.replaceChildren(
      h('h3', {}, 'Sauvegarde en ligne'),
      h('p', {}, '✓ Ton carnet est enregistré dans ta feuille Google Sheets.'),
      label,
      h('div.actions', {},
        h('button.btn.ghost', {
          type: 'button',
          onclick: () => sync.syncNow().then(() => toast('Synchronisé', 'ok')).catch((err) => toast(err.message, 'error')),
        }, '↻ Synchroniser maintenant'),
        h('button.link.danger', {
          type: 'button',
          onclick: () => { if (confirm('Débrancher la feuille ? (elle est conservée dans ton Google Drive)')) { sync.disconnect(); paint(); } },
        }, 'Débrancher')),
      h('p.muted.small', {}, 'Pour ouvrir le carnet sur un autre appareil : Réglages → « J’ai déjà une feuille », avec la même adresse et le même code secret : ',
        h('code', {}, sync.getConfig().token)));
  };
  paint();
  return card;
}

/** Sur l'écran d'accueil : retrouver un carnet existant (la clé OMDb est dans la feuille). */
export function restoreOnWelcome(onDone) {
  return h('details.restore', {},
    h('summary', {}, 'J’ai déjà un carnet en ligne (Google Sheets)'),
    h('p.muted.small', {}, 'Colle l’adresse de ton script et ton code secret : tout ton carnet et ta clé OMDb reviennent.'),
    connectForm({ onDone, submitLabel: 'Récupérer mon carnet' }));
}
