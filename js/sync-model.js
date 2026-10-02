// Fonctions pures (testées) de la sauvegarde en ligne : empreintes, changements à envoyer, fusion avec la feuille.

/** Empreinte courte d'un objet (djb2 sur le JSON) : sert à savoir ce qui a changé depuis le dernier envoi. */
export function hashOf(value) {
  const text = JSON.stringify(value ?? null);
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Réglages partagés via la feuille (la clé OMDb et les titres écartés des suggestions). */
export const settingsOf = (state) => ({ omdbKey: state.apiKey ?? '', dismissed: JSON.stringify(state.dismissed ?? []) });

/**
 * Ce qu'il faut envoyer : titres nouveaux ou modifiés, titres retirés, réglages changés.
 * `synced` = { titles: { id → empreinte }, settings: empreinte } au dernier envoi réussi. Renvoie null si rien.
 */
export function buildPush(state, synced = {}) {
  const known = synced.titles ?? {};
  const hashes = Object.fromEntries(state.titles.map((t) => [t.id, hashOf(t)]));
  const upsert = state.titles.filter((t) => known[t.id] !== hashes[t.id]);
  const remove = Object.keys(known).filter((id) => !(id in hashes));
  const settings = settingsOf(state);
  const settingsHash = hashOf(settings);
  const settingsChanged = settingsHash !== synced.settings;
  if (!upsert.length && !remove.length && !settingsChanged) return null;
  return {
    payload: { upsert, remove, ...(settingsChanged ? { settings } : {}) },
    synced: { titles: hashes, settings: settingsHash },
  };
}

/**
 * Fusionne la feuille dans le téléphone.
 * - titre modifié sur le téléphone depuis le dernier envoi → la version du téléphone gagne (elle sera envoyée) ;
 * - sinon → la version de la feuille gagne (modifiée sur un autre appareil) ;
 * - absent de la feuille mais déjà envoyé une fois → retiré ailleurs → retiré ici ;
 * - absent du téléphone mais déjà envoyé une fois → retiré ici → reste retiré (l'envoi le retirera de la feuille).
 * Renvoie { titles, synced } : `synced` décrit ce que contient désormais la feuille.
 */
export function mergeRemote(localTitles, remoteTitles, synced = {}) {
  const known = synced.titles ?? {};
  const local = new Map(localTitles.map((t) => [t.id, t]));
  const remote = new Map(remoteTitles.filter((t) => t && /^tt\d+$/.test(t.id)).map((t) => [t.id, t]));
  const merged = [];
  const sheetHashes = {};
  for (const [id, r] of remote) sheetHashes[id] = hashOf(r);
  for (const [id, t] of local) {
    const dirty = known[id] !== hashOf(t);
    if (remote.has(id)) merged.push(dirty ? t : remote.get(id));
    else if (dirty) merged.push(t); // nouveau sur ce téléphone, pas encore envoyé
  }
  for (const [id, r] of remote) {
    if (!local.has(id) && !(id in known)) merged.push(r); // ajouté sur un autre appareil
  }
  merged.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
  return { titles: merged, synced: { ...synced, titles: sheetHashes } };
}

/** Réglages de la feuille → morceaux d'état à appliquer (la clé locale reste si la feuille n'en a pas). */
export function settingsFromRemote(remote = {}, state) {
  let dismissed = state.dismissed ?? [];
  try {
    const fromSheet = JSON.parse(remote.dismissed ?? '[]');
    if (Array.isArray(fromSheet)) dismissed = [...new Set([...dismissed, ...fromSheet.filter((id) => /^tt\d+$/.test(id))])];
  } catch { /* valeur abîmée : ignorée */ }
  return { apiKey: state.apiKey || String(remote.omdbKey ?? '').trim(), dismissed };
}
