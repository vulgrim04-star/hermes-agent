-- Plan de catégories par défaut, adapté au contexte suisse (ménage, canton de Fribourg).
-- `is_system = 1` distingue l'apport initial de celui de l'utilisateur ; il n'empêche
-- ni la modification ni la suppression.

-- ------------------------------------------------------------------- Racines
INSERT INTO categories (parent_id, name, kind, sort_order, is_system) VALUES
  (NULL, 'Revenus du travail',    'revenu',   10, 1),
  (NULL, 'Autres revenus',        'revenu',   20, 1),
  (NULL, 'Logement',              'depense', 100, 1),
  (NULL, 'Santé',                 'depense', 110, 1),
  (NULL, 'Assurances',            'depense', 120, 1),
  (NULL, 'Alimentation',          'depense', 130, 1),
  (NULL, 'Transport',             'depense', 140, 1),
  (NULL, 'Télécom & abonnements', 'depense', 150, 1),
  (NULL, 'Loisirs',               'depense', 160, 1),
  (NULL, 'Shopping',              'depense', 170, 1),
  (NULL, 'Voyages',               'depense', 180, 1),
  (NULL, 'Impôts',                'depense', 190, 1),
  (NULL, 'Cadeaux & dons',        'depense', 200, 1),
  (NULL, 'Divers',                'depense', 210, 1),
  (NULL, 'Prévoyance',            'epargne', 300, 1),
  (NULL, 'Placements',            'epargne', 310, 1),
  (NULL, 'Épargne',               'epargne', 320, 1);

-- ------------------------------------------------------------ Sous-catégories
-- La sous-requête résout la racine par son nom ; l'index unique sur les racines
-- garantit qu'elle ne renvoie qu'une ligne.
INSERT INTO categories (parent_id, name, kind, sort_order, is_system)
SELECT (SELECT id FROM categories WHERE name = parent AND parent_id IS NULL),
       child, kind, rank, 1
FROM (
  SELECT 'Revenus du travail'    AS parent, 'Salaire'                            AS child, 'revenu'  AS kind, 10 AS rank UNION ALL
  SELECT 'Revenus du travail',           '13e salaire & bonus',                     'revenu',   20 UNION ALL
  SELECT 'Revenus du travail',           'Indemnités (AC, APG, AI)',                'revenu',   30 UNION ALL

  SELECT 'Autres revenus',               'Allocations familiales',                  'revenu',   10 UNION ALL
  SELECT 'Autres revenus',               'Rendements de titres',                    'revenu',   20 UNION ALL
  SELECT 'Autres revenus',               'Intérêts bancaires',                      'revenu',   30 UNION ALL
  SELECT 'Autres revenus',               'Remboursements',                          'revenu',   40 UNION ALL
  SELECT 'Autres revenus',               'Revenus divers',                          'revenu',   50 UNION ALL

  SELECT 'Logement',                     'Loyer',                                   'depense',  10 UNION ALL
  SELECT 'Logement',                     'Charges & chauffage',                     'depense',  20 UNION ALL
  SELECT 'Logement',                     'Électricité',                             'depense',  30 UNION ALL
  SELECT 'Logement',                     'Entretien & réparations',                 'depense',  40 UNION ALL

  SELECT 'Santé',                        'Primes LAMal',                            'depense',  10 UNION ALL
  SELECT 'Santé',                        'Assurance complémentaire (LCA)',          'depense',  20 UNION ALL
  SELECT 'Santé',                        'Franchise & quote-part',                  'depense',  30 UNION ALL
  SELECT 'Santé',                        'Dentiste',                                'depense',  40 UNION ALL
  SELECT 'Santé',                        'Pharmacie & optique',                     'depense',  50 UNION ALL

  SELECT 'Assurances',                   'Assurance ménage & RC',                   'depense',  10 UNION ALL
  SELECT 'Assurances',                   'Assurance véhicule',                      'depense',  20 UNION ALL
  SELECT 'Assurances',                   'Protection juridique',                    'depense',  30 UNION ALL
  SELECT 'Assurances',                   'Assurance vie',                           'depense',  40 UNION ALL

  SELECT 'Alimentation',                 'Courses',                                 'depense',  10 UNION ALL
  SELECT 'Alimentation',                 'Boulangerie & café',                      'depense',  20 UNION ALL
  SELECT 'Alimentation',                 'Restaurants & take-away',                 'depense',  30 UNION ALL

  SELECT 'Transport',                    'Abonnement CFF',                          'depense',  10 UNION ALL
  SELECT 'Transport',                    'Billets & transports publics',            'depense',  20 UNION ALL
  SELECT 'Transport',                    'Carburant',                               'depense',  30 UNION ALL
  SELECT 'Transport',                    'Entretien véhicule',                      'depense',  40 UNION ALL
  SELECT 'Transport',                    'Impôt & vignette véhicule',               'depense',  50 UNION ALL
  SELECT 'Transport',                    'Parking & péages',                        'depense',  60 UNION ALL

  SELECT 'Télécom & abonnements',        'Téléphonie mobile',                       'depense',  10 UNION ALL
  SELECT 'Télécom & abonnements',        'Internet & TV',                           'depense',  20 UNION ALL
  SELECT 'Télécom & abonnements',        'Redevance Serafe',                        'depense',  30 UNION ALL
  SELECT 'Télécom & abonnements',        'Abonnements numériques',                  'depense',  40 UNION ALL

  SELECT 'Loisirs',                      'Sport & fitness',                         'depense',  10 UNION ALL
  SELECT 'Loisirs',                      'Culture & sorties',                       'depense',  20 UNION ALL
  SELECT 'Loisirs',                      'Hobbies',                                 'depense',  30 UNION ALL

  SELECT 'Shopping',                     'Vêtements & chaussures',                  'depense',  10 UNION ALL
  SELECT 'Shopping',                     'Équipement du ménage',                    'depense',  20 UNION ALL
  SELECT 'Shopping',                     'Électronique',                            'depense',  30 UNION ALL
  SELECT 'Shopping',                     'Soins & coiffeur',                        'depense',  40 UNION ALL

  SELECT 'Voyages',                      'Transport & vols',                        'depense',  10 UNION ALL
  SELECT 'Voyages',                      'Hébergement',                             'depense',  20 UNION ALL
  SELECT 'Voyages',                      'Dépenses sur place',                      'depense',  30 UNION ALL

  SELECT 'Impôts',                       'Acomptes ICC (cantonal et communal)',     'depense',  10 UNION ALL
  SELECT 'Impôts',                       'Acomptes IFD (fédéral direct)',           'depense',  20 UNION ALL
  SELECT 'Impôts',                       'Solde d''impôt',                          'depense',  30 UNION ALL
  SELECT 'Impôts',                       'Impôt anticipé & autres',                 'depense',  40 UNION ALL

  SELECT 'Cadeaux & dons',               'Cadeaux',                                 'depense',  10 UNION ALL
  SELECT 'Cadeaux & dons',               'Dons',                                    'depense',  20 UNION ALL

  SELECT 'Divers',                       'Frais bancaires',                         'depense',  10 UNION ALL
  SELECT 'Divers',                       'Retraits en espèces',                     'depense',  20 UNION ALL
  SELECT 'Divers',                       'Dépenses diverses',                       'depense',  30 UNION ALL

  SELECT 'Prévoyance',                   'Pilier 3a',                               'epargne',  10 UNION ALL
  SELECT 'Prévoyance',                   'Rachat LPP (2e pilier)',                  'epargne',  20 UNION ALL

  SELECT 'Placements',                   'ETF',                                     'epargne',  10 UNION ALL
  SELECT 'Placements',                   'Bitcoin',                                 'epargne',  20 UNION ALL
  SELECT 'Placements',                   'Autres titres',                           'epargne',  30 UNION ALL

  SELECT 'Épargne',                      'Fonds d''urgence',                        'epargne',  10 UNION ALL
  SELECT 'Épargne',                      'Épargne projet',                          'epargne',  20 UNION ALL
  SELECT 'Épargne',                      'Virement d''épargne',                     'epargne',  30
);
