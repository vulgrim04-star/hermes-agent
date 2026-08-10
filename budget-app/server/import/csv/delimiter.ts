/**
 * Détection du séparateur de colonnes.
 *
 * On ne code pas en dur le point-virgule : les exports UBS alternent `;`, `,`
 * et la tabulation selon la langue de l'e-banking et le format choisi. Le
 * critère retenu est la *régularité* — le bon séparateur est celui qui découpe
 * le fichier en un nombre de colonnes constant, pas celui qui apparaît le plus.
 */

const CANDIDATES = [';', ',', '\t', '|'] as const;

/** Compte les occurrences de `mark` hors des champs entre guillemets. */
export function countOutsideQuotes(line: string, mark: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line.charAt(i);
    if (char === '"') {
      // `""` à l'intérieur d'un champ est un guillemet échappé, pas une bascule.
      if (inQuotes && line.charAt(i + 1) === '"') {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && char === mark) count += 1;
  }
  return count;
}

export interface DelimiterGuess {
  delimiter: string;
  /** Part des lignes qui présentent le nombre de colonnes dominant, 0 à 1. */
  confidence: number;
}

export function detectDelimiter(lines: readonly string[]): DelimiterGuess {
  const sample = lines.filter((line) => line.trim() !== '').slice(0, 50);
  if (sample.length === 0) return { delimiter: ';', confidence: 0 };

  let best: DelimiterGuess = { delimiter: ';', confidence: 0 };

  for (const candidate of CANDIDATES) {
    const counts = sample.map((line) => countOutsideQuotes(line, candidate));
    const tally = new Map<number, number>();
    for (const count of counts) {
      if (count === 0) continue; // une ligne sans séparateur ne prouve rien
      tally.set(count, (tally.get(count) ?? 0) + 1);
    }
    if (tally.size === 0) continue;

    let dominantCount = 0;
    let dominantLines = 0;
    for (const [count, lineCount] of tally) {
      if (lineCount > dominantLines || (lineCount === dominantLines && count > dominantCount)) {
        dominantCount = count;
        dominantLines = lineCount;
      }
    }

    // Pondéré par le nombre de colonnes : à régularité égale, un séparateur qui
    // découpe en 8 colonnes est plus crédible qu'un qui en découpe 2 (une
    // virgule décimale produit exactement ce faux positif à 2 colonnes).
    const regularity = dominantLines / sample.length;
    const confidence = regularity * Math.min(1, dominantCount / 3);

    if (confidence > best.confidence) best = { delimiter: candidate, confidence };
  }

  return best;
}
