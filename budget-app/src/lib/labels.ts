import type { Owner } from './api.js';

/** Libellés des personnes du ménage, paramétrables dans les réglages. */
export const OWNER_ORDER: Owner[] = ['p1', 'p2', 'commun'];

export function ownerLabel(owner: Owner, settings: Record<string, string> = {}): string {
  switch (owner) {
    case 'p1':
      return settings.person_1_label ?? 'Personne 1';
    case 'p2':
      return settings.person_2_label ?? 'Personne 2';
    default:
      return 'Commun';
  }
}

export const KIND_LABELS: Record<string, string> = {
  revenu: 'Revenu',
  depense: 'Dépense',
  epargne: 'Épargne & investissement',
};

export const FIELD_LABELS: Record<string, string> = {
  valueDate: 'Date de valeur',
  bookingDate: 'Date comptable',
  label: 'Libellé',
  debit: 'Débit',
  credit: 'Crédit',
  amount: 'Montant (signé)',
  balance: 'Solde',
  reference: 'Référence',
  currency: 'Devise',
  counterparty: 'Contrepartie',
};

export const RECONCILIATION_LABELS: Record<string, string> = {
  ok: 'Rapprochement bouclé',
  ko: 'Écart de rapprochement',
  absent: 'Aucun solde à rapprocher',
};
