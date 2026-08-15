/**
 * La clôture du mois.
 *
 * Ce qui est éprouvé ici tient en une phrase : **la liste ne montre que ce qui
 * est en attente**. Une liste qui contient toujours les mêmes huit lignes,
 * dont six vertes, cesse d'être lue au troisième mois — et c'est précisément
 * le genre de régression qu'aucun écran ne trahit.
 */

import { describe, expect, it } from 'vitest';

import { etatCloture } from './cloture.js';
import { emptyState, normLabel, setAccountBalance } from './ledger.js';
import { setBudget } from './budgets.js';
import { addAsset } from './networth.js';

let compteur = 0;
function ecriture(state, { label = 'X', date = '2026-03-05', cents = -4_500, cat = null, transfer = 0, acc = 'CH00' }) {
  compteur += 1;
  state.tx.push({
    id: compteur, acc, date, cents, label, norm: normLabel(label),
    cp: null, ext: null, cat, note: null, transfer,
  });
  return compteur;
}

/** Un journal propre : tout est classé finement, rien n'est en attente. */
function propre() {
  const state = emptyState();
  state.accounts.CH00 = { key: 'CH00', label: 'Compte' };
  ecriture(state, { label: 'COOP', cat: 'Courses' });
  setAccountBalance(state, 'CH00', '2026-03-31', 1_000_000);
  return state;
}

describe('clôture du mois', () => {
  it('ne dit rien quand il n’y a rien à faire', () => {
    const etat = etatCloture(propre(), '2026-03', '2026-03-31');
    expect(etat.taches).toEqual([]);
    expect(etat.reste).toBe(0);
  });

  it('remonte une écriture sans catégorie', () => {
    const state = propre();
    ecriture(state, { label: 'INCONNU' });
    const t = etatCloture(state, '2026-03', '2026-03-31').taches.find((x) => x.cle === 'trancher');
    expect(t.compte).toBe(1);
    expect(t.vers).toBe('/revision');
  });

  it('remonte une catégorie de la banque à préciser, avec son montant', () => {
    const state = propre();
    ecriture(state, { label: 'SWICA', cents: -43_935, cat: 'Assurances' });
    const t = etatCloture(state, '2026-03', '2026-03-31').taches.find((x) => x.cle === 'affiner');
    expect(t.compte).toBe(1);
    expect(t.montantCents).toBe(43_935);
  });

  it('remonte un compte sans solde établi', () => {
    const state = propre();
    state.accounts.CARTE = { key: 'CARTE', label: 'Carte' };
    ecriture(state, { label: 'ACHAT', cat: 'Courses', acc: 'CARTE' });
    expect(etatCloture(state, '2026-03', '2026-03-31').taches.find((x) => x.cle === 'soldes').compte).toBe(1);
  });

  it('remonte un intervalle qui ne boucle pas, et le met en tête', () => {
    const state = propre();
    // Un second solde incompatible avec les mouvements du mois d'avril.
    setAccountBalance(state, 'CH00', '2026-04-30', 1_500_000);
    const etat = etatCloture(state, '2026-04', '2026-04-30');
    expect(etat.taches[0].cle).toBe('ecarts');
    expect(etat.alertes).toBeGreaterThan(0);
  });

  it('remonte une enveloppe dépassée', () => {
    const state = propre();
    setBudget(state, 'Courses', null, 1_000);
    const t = etatCloture(state, '2026-03', '2026-03-31').taches.find((x) => x.cle === 'budgets');
    expect(t.compte).toBe(1);
    expect(t.gravite).toBe('alerte');
  });

  it('remonte une position dont la valeur n’a pas été relevée', () => {
    const state = propre();
    addAsset(state, { label: 'ETF', kind: 'titres', account: null });
    const t = etatCloture(state, '2026-03', '2026-03-31').taches.find((x) => x.cle === 'patrimoine');
    expect(t.compte).toBe(1);
  });

  it('classe les alertes avant le reste, et le plus gros avant le plus petit', () => {
    const state = propre();
    ecriture(state, { label: 'A' });
    ecriture(state, { label: 'B' });
    ecriture(state, { label: 'SWICA', cents: -43_935, cat: 'Assurances' });
    setBudget(state, 'Courses', null, 1_000);

    const cles = etatCloture(state, '2026-03', '2026-03-31').taches.map((t) => t.cle);
    // L'alerte d'abord, puis l'attention (2 à trancher), puis l'information.
    expect(cles[0]).toBe('budgets');
    expect(cles.indexOf('trancher')).toBeLessThan(cles.indexOf('affiner'));
  });

  it('ne lève pas sur un journal vierge', () => {
    expect(etatCloture(emptyState(), '2026-03', '2026-03-31').taches).toEqual([]);
  });
});
