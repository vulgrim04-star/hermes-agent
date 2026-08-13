/**
 * Pastille ronde à initiale.
 *
 * La teinte est **déduite du nom** par un hachage : le même tiers garde la même
 * couleur d'une session à l'autre, sans qu'aucune correspondance ne soit
 * stockée, et sans qu'aucun logo ne soit téléchargé — ce qui contredirait
 * « tout reste local ».
 *
 * La couleur est écrite en `hsl` avec une opacité de fond faible et un texte
 * pleinement saturé : la même paire tient sur le fond sombre et sur le fond
 * clair, sans qu'on ait à décliner deux palettes.
 */

const IGNORE = /^(LE|LA|LES|DE|DU|DES|SA|SARL|AG|GMBH|SA)$/;

/** Hachage stable et court — FNV-1a, largement suffisant pour choisir une teinte. */
function teinte(nom) {
  let h = 0x811c9dc5;
  for (let i = 0; i < nom.length; i += 1) {
    h ^= nom.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return Math.abs(h) % 360;
}

/**
 * Une ou deux lettres, en sautant les mots vides : « LA POSTE » donne P, pas L.
 * Un libellé sans lettre du tout (un numéro de référence) rend « ? » plutôt
 * qu'une pastille vide, qui ressemblerait à un défaut d'affichage.
 */
export function initiales(nom) {
  const mots = String(nom || '')
    .toUpperCase()
    .split(/[^A-ZÀ-ÖØ-Þ0-9]+/)
    .filter((m) => m && !IGNORE.test(m));
  if (!mots.length) return '?';
  return mots[0][0];
}

export default function Avatar({ nom, taille = 38 }) {
  const h = teinte(String(nom || ''));
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{
        width: taille,
        height: taille,
        fontSize: Math.round(taille * 0.4),
        background: `hsl(${h} 62% 52% / 0.18)`,
        color: `hsl(${h} 62% 62%)`,
      }}
    >
      {initiales(nom)}
    </span>
  );
}
