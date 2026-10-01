// Fonctions pures (testées) : extraire le synopsis français d'un article Wikipédia en texte brut.

// Sections reconnues, par ordre de préférence (« Résumé détaillé » en dernier : il raconte souvent la fin).
const SYNOPSIS_HEADINGS = [/^synopsis/i, /^résumé(?!.*détaillé)/i, /^intrigue/i, /^argument/i, /^histoire$/i, /^trame/i, /^sujet/i, /^résumé/i];

const MAX_INTRO_CHARS = 900;

/** Titre de page Wikipédia → titre français affichable (« Joker (film, 2019) » → « Joker »). */
export function cleanFrTitle(pageTitle) {
  return String(pageTitle ?? '')
    .replace(/\s*\((?:[^()]*\b(?:film|série|feuilleton|mini-série|téléfilm|anime|émission)\b[^()]*)\)\s*$/i, '')
    .trim() || null;
}

/** Texte → paragraphes propres (sans sous-titres « === … === », sans lignes vides). */
function paragraphs(text) {
  return String(text ?? '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !/^=+.*=+$/.test(line));
}

/** Découpe un extrait « explaintext + exsectionformat=wiki » en { intro, sections: [{ heading, body }] } (niveau 2). */
export function splitSections(extract) {
  const parts = String(extract ?? '').split(/^==\s*([^=\n].*?)\s*==\s*$/m);
  const [intro, ...rest] = parts;
  const sections = [];
  for (let i = 0; i < rest.length; i += 2) sections.push({ heading: rest[i].trim(), body: rest[i + 1] ?? '' });
  return { intro, sections };
}

/**
 * Extrait d'article → { synopsis: [paragraphes] | null, intro: string | null }.
 * `intro` (présentation de l'article) ne sert que si aucun synopsis n'existe.
 */
export function extractSynopsis(extract) {
  const { intro, sections } = splitSections(extract);
  let synopsis = null;
  for (const pattern of SYNOPSIS_HEADINGS) {
    const found = sections.find((s) => pattern.test(s.heading) && paragraphs(s.body).length);
    if (found) { synopsis = paragraphs(found.body); break; }
  }
  const introText = paragraphs(intro).join(' ');
  return {
    synopsis,
    intro: introText ? (introText.length > MAX_INTRO_CHARS ? `${introText.slice(0, MAX_INTRO_CHARS).replace(/\s+\S*$/, '')}…` : introText) : null,
  };
}
