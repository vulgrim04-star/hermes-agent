-- Catégories livrées par la banque.
--
-- L'export UBS porte une colonne « Catégorie », remplie sur toutes les lignes.
-- C'est un classement gratuit et déjà fait, qu'il serait absurde de jeter : sur
-- l'export réel, il couvre les trois quarts des écritures.
--
-- Il n'est pourtant pas repris tel quel. Le classement de la banque est le sien,
-- pas celui du ménage : « Ménage » ou « Autres transactions » ne veulent rien
-- dire dans un plan de comptes. D'où une table de correspondance, éditable, où
-- les libellés évidents sont rapprochés d'une catégorie et les ambigus laissés
-- vides — une écriture sans catégorie remonte dans la file de révision, une
-- écriture mal catégorisée n'y remonte jamais.

ALTER TABLE transactions ADD COLUMN external_category TEXT;
ALTER TABLE pending_transactions ADD COLUMN external_category TEXT;

CREATE INDEX transactions_external_category ON transactions (external_category);

CREATE TABLE external_category_map (
  id                  INTEGER PRIMARY KEY,
  source              TEXT NOT NULL DEFAULT 'ubs',
  external_label      TEXT NOT NULL,
  -- Majuscules, sans accents ni ponctuation : même normalisation que les
  -- libellés d'écriture, pour que « Santé, sport et beauté » se retrouve quel
  -- que soit l'habillage typographique de l'export.
  external_normalized TEXT NOT NULL,
  category_id         INTEGER REFERENCES categories (id) ON DELETE SET NULL,
  -- Un règlement de carte n'est pas une dépense : le traiter comme une
  -- catégorie gonflerait les charges du montant déjà dépensé à l'achat.
  treat_as            TEXT NOT NULL DEFAULT 'categorie'
                        CHECK (treat_as IN ('categorie', 'transfert-interne', 'ignorer')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source, external_normalized)
);

-- Les vingt libellés rencontrés sur un export UBS réel.
INSERT INTO external_category_map (source, external_label, external_normalized, category_id, treat_as)
SELECT 'ubs', seed.label, seed.normalized,
       (SELECT c.id
          FROM categories c
          LEFT JOIN categories p ON p.id = c.parent_id
         WHERE c.name = seed.category
           AND (seed.parent IS NULL OR p.name = seed.parent)
         LIMIT 1),
       seed.treat_as
  FROM (
    SELECT 'Alimentation' AS label, 'ALIMENTATION' AS normalized,
           'Alimentation' AS parent, 'Courses' AS category, 'categorie' AS treat_as
    UNION ALL SELECT 'Restaurants et bars', 'RESTAURANTS ET BARS', 'Alimentation', 'Restaurants & take-away', 'categorie'
    UNION ALL SELECT 'Transports', 'TRANSPORTS', NULL, 'Transport', 'categorie'
    UNION ALL SELECT 'Achats', 'ACHATS', NULL, 'Shopping', 'categorie'
    UNION ALL SELECT 'Assurances', 'ASSURANCES', NULL, 'Assurances', 'categorie'
    UNION ALL SELECT 'Impôts et administration', 'IMPOTS ET ADMINISTRATION', NULL, 'Impôts', 'categorie'
    UNION ALL SELECT 'Salaire et rentes', 'SALAIRE ET RENTES', 'Revenus du travail', 'Salaire', 'categorie'
    UNION ALL SELECT 'Autres revenus', 'AUTRES REVENUS', 'Autres revenus', 'Revenus divers', 'categorie'
    UNION ALL SELECT 'Loisirs', 'LOISIRS', NULL, 'Loisirs', 'categorie'
    UNION ALL SELECT 'Voyages', 'VOYAGES', NULL, 'Voyages', 'categorie'
    UNION ALL SELECT 'Santé, sport et beauté', 'SANTE SPORT ET BEAUTE', NULL, 'Santé', 'categorie'
    UNION ALL SELECT 'Ménage', 'MENAGE', NULL, 'Logement', 'categorie'
    UNION ALL SELECT 'Économies et placements', 'ECONOMIES ET PLACEMENTS', NULL, 'Placements', 'categorie'
    -- « Frais accessoires » désigne les charges d'un logement, pas des frais bancaires.
    UNION ALL SELECT 'Frais accessoires', 'FRAIS ACCESSOIRES', 'Logement', 'Charges & chauffage', 'categorie'
    UNION ALL SELECT 'Frais', 'FRAIS', 'Divers', 'Frais bancaires', 'categorie'
    -- Deux mouvements entre comptes du ménage : à apparier, pas à classer.
    UNION ALL SELECT 'Factures de carte de crédit', 'FACTURES DE CARTE DE CREDIT', NULL, NULL, 'transfert-interne'
    UNION ALL SELECT 'Transferts entre comptes', 'TRANSFERTS ENTRE COMPTES', NULL, NULL, 'transfert-interne'
    -- Trop vagues ou sans équivalent dans le plan du ménage : laissés à décider,
    -- donc visibles dans la file de révision.
    UNION ALL SELECT 'Autres transactions', 'AUTRES TRANSACTIONS', NULL, NULL, 'categorie'
    UNION ALL SELECT 'Crédits et hypothèques', 'CREDITS ET HYPOTHEQUES', NULL, NULL, 'categorie'
    UNION ALL SELECT 'Formation', 'FORMATION', NULL, NULL, 'categorie'
  ) AS seed;
