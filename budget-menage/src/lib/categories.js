/**
 * Plan de comptes du ménage et correspondance des catégories livrées par la banque.
 *
 * Les libellés ambigus de la banque (« Autres transactions », « Formation »)
 * sont volontairement laissés sans correspondance : une écriture sans catégorie
 * remonte dans la file de révision, une écriture mal classée n'y remonte jamais.
 */

export const CATEGORIES = [
  {
    "name": "Revenus du travail",
    "parent": null,
    "kind": "revenu"
  },
  {
    "name": "Autres revenus",
    "parent": null,
    "kind": "revenu"
  },
  {
    "name": "Logement",
    "parent": null,
    "kind": "depense"
  },
  {
    "name": "Santé",
    "parent": null,
    "kind": "depense"
  },
  {
    "name": "Assurances",
    "parent": null,
    "kind": "depense"
  },
  {
    "name": "Alimentation",
    "parent": null,
    "kind": "depense"
  },
  {
    "name": "Transport",
    "parent": null,
    "kind": "depense"
  },
  {
    "name": "Télécom & abonnements",
    "parent": null,
    "kind": "depense"
  },
  {
    "name": "Loisirs",
    "parent": null,
    "kind": "depense"
  },
  {
    "name": "Shopping",
    "parent": null,
    "kind": "depense"
  },
  {
    "name": "Voyages",
    "parent": null,
    "kind": "depense"
  },
  {
    "name": "Impôts",
    "parent": null,
    "kind": "depense"
  },
  {
    "name": "Cadeaux & dons",
    "parent": null,
    "kind": "depense"
  },
  {
    "name": "Divers",
    "parent": null,
    "kind": "depense"
  },
  {
    "name": "Prévoyance",
    "parent": null,
    "kind": "epargne"
  },
  {
    "name": "Placements",
    "parent": null,
    "kind": "epargne"
  },
  {
    "name": "Épargne",
    "parent": null,
    "kind": "epargne"
  },
  {
    "name": "Salaire",
    "parent": "Revenus du travail",
    "kind": "revenu"
  },
  {
    "name": "13e salaire & bonus",
    "parent": "Revenus du travail",
    "kind": "revenu"
  },
  {
    "name": "Indemnités (AC, APG, AI)",
    "parent": "Revenus du travail",
    "kind": "revenu"
  },
  {
    "name": "Allocations familiales",
    "parent": "Autres revenus",
    "kind": "revenu"
  },
  {
    "name": "Rendements de titres",
    "parent": "Autres revenus",
    "kind": "revenu"
  },
  {
    "name": "Intérêts bancaires",
    "parent": "Autres revenus",
    "kind": "revenu"
  },
  {
    "name": "Remboursements",
    "parent": "Autres revenus",
    "kind": "revenu"
  },
  {
    "name": "Revenus divers",
    "parent": "Autres revenus",
    "kind": "revenu"
  },
  {
    "name": "Loyer",
    "parent": "Logement",
    "kind": "depense"
  },
  {
    "name": "Charges & chauffage",
    "parent": "Logement",
    "kind": "depense"
  },
  {
    "name": "Électricité",
    "parent": "Logement",
    "kind": "depense"
  },
  {
    "name": "Entretien & réparations",
    "parent": "Logement",
    "kind": "depense"
  },
  {
    "name": "Primes LAMal",
    "parent": "Santé",
    "kind": "depense"
  },
  {
    "name": "Assurance complémentaire (LCA)",
    "parent": "Santé",
    "kind": "depense"
  },
  {
    "name": "Franchise & quote-part",
    "parent": "Santé",
    "kind": "depense"
  },
  {
    "name": "Dentiste",
    "parent": "Santé",
    "kind": "depense"
  },
  {
    "name": "Pharmacie & optique",
    "parent": "Santé",
    "kind": "depense"
  },
  {
    "name": "Assurance ménage & RC",
    "parent": "Assurances",
    "kind": "depense"
  },
  {
    "name": "Assurance véhicule",
    "parent": "Assurances",
    "kind": "depense"
  },
  {
    "name": "Protection juridique",
    "parent": "Assurances",
    "kind": "depense"
  },
  {
    "name": "Assurance vie",
    "parent": "Assurances",
    "kind": "depense"
  },
  {
    "name": "Courses",
    "parent": "Alimentation",
    "kind": "depense"
  },
  {
    "name": "Boulangerie & café",
    "parent": "Alimentation",
    "kind": "depense"
  },
  {
    "name": "Restaurants & take-away",
    "parent": "Alimentation",
    "kind": "depense"
  },
  {
    "name": "Abonnement CFF",
    "parent": "Transport",
    "kind": "depense"
  },
  {
    "name": "Billets & transports publics",
    "parent": "Transport",
    "kind": "depense"
  },
  {
    "name": "Carburant",
    "parent": "Transport",
    "kind": "depense"
  },
  {
    "name": "Entretien véhicule",
    "parent": "Transport",
    "kind": "depense"
  },
  {
    "name": "Impôt & vignette véhicule",
    "parent": "Transport",
    "kind": "depense"
  },
  {
    "name": "Parking & péages",
    "parent": "Transport",
    "kind": "depense"
  },
  {
    "name": "Téléphonie mobile",
    "parent": "Télécom & abonnements",
    "kind": "depense"
  },
  {
    "name": "Internet & TV",
    "parent": "Télécom & abonnements",
    "kind": "depense"
  },
  {
    "name": "Redevance Serafe",
    "parent": "Télécom & abonnements",
    "kind": "depense"
  },
  {
    "name": "Abonnements numériques",
    "parent": "Télécom & abonnements",
    "kind": "depense"
  },
  {
    "name": "Sport & fitness",
    "parent": "Loisirs",
    "kind": "depense"
  },
  {
    "name": "Culture & sorties",
    "parent": "Loisirs",
    "kind": "depense"
  },
  {
    "name": "Hobbies",
    "parent": "Loisirs",
    "kind": "depense"
  },
  {
    "name": "Vêtements & chaussures",
    "parent": "Shopping",
    "kind": "depense"
  },
  {
    "name": "Équipement du ménage",
    "parent": "Shopping",
    "kind": "depense"
  },
  {
    "name": "Électronique",
    "parent": "Shopping",
    "kind": "depense"
  },
  {
    "name": "Soins & coiffeur",
    "parent": "Shopping",
    "kind": "depense"
  },
  {
    "name": "Transport & vols",
    "parent": "Voyages",
    "kind": "depense"
  },
  {
    "name": "Hébergement",
    "parent": "Voyages",
    "kind": "depense"
  },
  {
    "name": "Dépenses sur place",
    "parent": "Voyages",
    "kind": "depense"
  },
  {
    "name": "Acomptes ICC (cantonal et communal)",
    "parent": "Impôts",
    "kind": "depense"
  },
  {
    "name": "Acomptes IFD (fédéral direct)",
    "parent": "Impôts",
    "kind": "depense"
  },
  {
    "name": "Solde d'impôt",
    "parent": "Impôts",
    "kind": "depense"
  },
  {
    "name": "Impôt anticipé & autres",
    "parent": "Impôts",
    "kind": "depense"
  },
  {
    "name": "Cadeaux",
    "parent": "Cadeaux & dons",
    "kind": "depense"
  },
  {
    "name": "Dons",
    "parent": "Cadeaux & dons",
    "kind": "depense"
  },
  {
    "name": "Frais bancaires",
    "parent": "Divers",
    "kind": "depense"
  },
  {
    "name": "Retraits en espèces",
    "parent": "Divers",
    "kind": "depense"
  },
  {
    "name": "Dépenses diverses",
    "parent": "Divers",
    "kind": "depense"
  },
  {
    "name": "Pilier 3a",
    "parent": "Prévoyance",
    "kind": "epargne"
  },
  {
    "name": "Rachat LPP (2e pilier)",
    "parent": "Prévoyance",
    "kind": "epargne"
  },
  {
    "name": "ETF",
    "parent": "Placements",
    "kind": "epargne"
  },
  {
    "name": "Bitcoin",
    "parent": "Placements",
    "kind": "epargne"
  },
  {
    "name": "Autres titres",
    "parent": "Placements",
    "kind": "epargne"
  },
  {
    "name": "Fonds d'urgence",
    "parent": "Épargne",
    "kind": "epargne"
  },
  {
    "name": "Épargne projet",
    "parent": "Épargne",
    "kind": "epargne"
  },
  {
    "name": "Virement d'épargne",
    "parent": "Épargne",
    "kind": "epargne"
  }
];

export const BANK_MAP_SEED = [
  {
    "label": "Alimentation",
    "cat": "Courses",
    "treat": "categorie"
  },
  {
    "label": "Restaurants et bars",
    "cat": "Restaurants & take-away",
    "treat": "categorie"
  },
  {
    "label": "Transports",
    "cat": "Transport",
    "treat": "categorie"
  },
  {
    "label": "Achats",
    "cat": "Shopping",
    "treat": "categorie"
  },
  {
    "label": "Assurances",
    "cat": "Assurances",
    "treat": "categorie"
  },
  {
    "label": "Impôts et administration",
    "cat": "Impôts",
    "treat": "categorie"
  },
  {
    "label": "Salaire et rentes",
    "cat": "Salaire",
    "treat": "categorie"
  },
  {
    "label": "Autres revenus",
    "cat": "Revenus divers",
    "treat": "categorie"
  },
  {
    "label": "Loisirs",
    "cat": "Loisirs",
    "treat": "categorie"
  },
  {
    "label": "Voyages",
    "cat": "Voyages",
    "treat": "categorie"
  },
  {
    "label": "Santé, sport et beauté",
    "cat": "Santé",
    "treat": "categorie"
  },
  {
    "label": "Ménage",
    "cat": "Logement",
    "treat": "categorie"
  },
  {
    "label": "Économies et placements",
    "cat": "Placements",
    "treat": "categorie"
  },
  {
    "label": "Frais accessoires",
    "cat": "Charges & chauffage",
    "treat": "categorie"
  },
  {
    "label": "Frais",
    "cat": "Frais bancaires",
    "treat": "categorie"
  },
  {
    "label": "Factures de carte de crédit",
    "cat": null,
    "treat": "transfert-interne"
  },
  {
    "label": "Transferts entre comptes",
    "cat": null,
    "treat": "transfert-interne"
  },
  {
    "label": "Autres transactions",
    "cat": null,
    "treat": "categorie"
  },
  {
    "label": "Crédits et hypothèques",
    "cat": null,
    "treat": "categorie"
  },
  {
    "label": "Formation",
    "cat": null,
    "treat": "categorie"
  }
];

const BY_NAME = new Map(CATEGORIES.map((c) => [c.name, c]));

export function catOf(name) {
  return name ? BY_NAME.get(name) || null : null;
}

/** Racine d'une catégorie : c'est elle qui porte les agrégats et le camembert. */
export function rootOf(name) {
  const c = catOf(name);
  return c ? c.parent || c.name : null;
}

/**
 * Type de mouvement. Une écriture sans catégorie est classée par son signe :
 * elle reste dans les totaux, faute de quoi le tableau de bord serait faux en
 * silence sur ce qui n'a pas encore été affecté.
 */
export function kindOf(name, cents) {
  const c = catOf(name);
  if (c) return c.kind;
  return cents > 0 ? 'revenu' : 'depense';
}

export const LEAVES = CATEGORIES.filter((c) => c.parent);
