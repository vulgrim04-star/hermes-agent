import { fmt } from '../lib/money.js';

/**
 * Le chiffre de l'écran, et sa variation.
 *
 * Un seul par écran, et il est énorme : c'est la question qu'on se pose en
 * ouvrant l'application, elle mérite d'être lue sans être cherchée.
 *
 * La variation porte **le montant et le pourcentage**. Les deux ne disent pas
 * la même chose : le montant dit combien, le pourcentage dit si c'est beaucoup.
 * Sur un patrimoine, +12'000 est une somme ; +3,9 % est une performance.
 *
 * Le pourcentage n'est calculé que si la base est non nulle et de même signe —
 * une variation « de −200 à +300 » n'a pas de pourcentage qui veuille dire
 * quelque chose, et en afficher un (+250 %) serait pire que rien.
 */
export function pourcentage(depart, arrivee) {
  if (!depart) return null;
  if (depart < 0 && arrivee > 0) return null;
  if (depart > 0 && arrivee < 0) return null;
  return (arrivee - depart) / Math.abs(depart);
}

export default function Hero({ label, cents, alerte = false, variation = null, enfants = null }) {
  return (
    <dl className="hero">
      <dt>{label}</dt>
      <dd className={alerte ? 'alert' : undefined}>{fmt(cents)}</dd>
      {variation && <Variation {...variation} />}
      {enfants}
    </dl>
  );
}

/**
 * `depuis` nomme la base de comparaison. Sans elle, une variation est un
 * chiffre en l'air : « +12'000 » ne veut rien dire tant qu'on ignore depuis
 * quand.
 */
export function Variation({ cents, part = null, depuis = null }) {
  const sens = cents > 0 ? 'up' : cents < 0 ? 'down' : '';
  return (
    <p className={`delta ${sens}`.trim()}>
      <b>{cents > 0 ? '+' : cents < 0 ? '−' : ''}{fmt(Math.abs(cents))}</b>
      {part !== null && <span>{cents > 0 ? '+' : cents < 0 ? '−' : ''}{(Math.abs(part) * 100).toFixed(1).replace(/\.0$/, '')} %</span>}
      {depuis && <span className="quoi">{depuis}</span>}
    </p>
  );
}
