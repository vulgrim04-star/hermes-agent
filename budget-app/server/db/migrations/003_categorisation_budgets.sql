-- Catégorisation, transferts internes et budgets.

-- ------------------------------------------------- Règles de catégorisation
-- Un motif `contient` est comparé au libellé normalisé déjà stocké sur
-- l'écriture (majuscules, sans accents ni ponctuation) : « Coop Pronto » et
-- « COOP-PRONTO » désignent alors le même commerçant. Un motif `regex`
-- s'applique au libellé brut, insensible à la casse — qui écrit une expression
-- régulière veut le texte réel, pas sa forme aplatie.
CREATE TABLE category_rules (
  id           INTEGER PRIMARY KEY,
  pattern      TEXT NOT NULL,
  match_type   TEXT NOT NULL DEFAULT 'contient' CHECK (match_type IN ('contient', 'regex')),
  category_id  INTEGER REFERENCES categories (id) ON DELETE CASCADE,
  -- Attribution à poser en même temps que la catégorie, facultative.
  owner        TEXT CHECK (owner IN ('p1', 'p2', 'commun')),
  -- Filtres facultatifs, qui évitent les faux positifs : un motif « SALAIRE »
  -- n'a de sens qu'au crédit, un motif de commerçant que sur un compte donné.
  direction    TEXT NOT NULL DEFAULT 'tout' CHECK (direction IN ('tout', 'debit', 'credit')),
  account_id   INTEGER REFERENCES accounts (id) ON DELETE CASCADE,
  priority     INTEGER NOT NULL DEFAULT 100,
  is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  hits         INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX category_rules_priority ON category_rules (is_active, priority, id);

-- ------------------------------------------------------ Transferts internes
-- Un virement du compte courant vers le compte d'épargne apparaît deux fois
-- quand les deux comptes sont importés : en débit d'un côté, en crédit de
-- l'autre. Sans appariement, il gonfle à la fois les dépenses et les revenus.
--
-- Une paire rejetée est conservée en base : sans cela, elle reviendrait à
-- chaque détection et l'utilisateur devrait l'écarter indéfiniment.
CREATE TABLE internal_transfers (
  id                 INTEGER PRIMARY KEY,
  out_transaction_id INTEGER NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
  in_transaction_id  INTEGER NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
  status             TEXT NOT NULL DEFAULT 'propose'
                       CHECK (status IN ('propose', 'confirme', 'rejete')),
  day_gap            INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at         TEXT,
  UNIQUE (out_transaction_id, in_transaction_id)
);

-- Une écriture ne peut appartenir qu'à une seule paire confirmée.
CREATE UNIQUE INDEX internal_transfers_out_confirmed
  ON internal_transfers (out_transaction_id) WHERE status = 'confirme';
CREATE UNIQUE INDEX internal_transfers_in_confirmed
  ON internal_transfers (in_transaction_id) WHERE status = 'confirme';
CREATE INDEX internal_transfers_status ON internal_transfers (status);

-- Drapeau porté par l'écriture : les agrégats filtrent sans jointure.
ALTER TABLE transactions
  ADD COLUMN is_internal_transfer INTEGER NOT NULL DEFAULT 0 CHECK (is_internal_transfer IN (0, 1));

-- ------------------------------------------------------------------ Budgets
-- `period` NULL porte le budget mensuel par défaut ; 'AAAA-MM' une dérogation
-- du mois. Les primes d'assurance et les acomptes d'impôts ne tombent pas tous
-- les mois : le budget d'un mois vaut COALESCE(dérogation, défaut).
CREATE TABLE budgets (
  id           INTEGER PRIMARY KEY,
  category_id  INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  period       TEXT,
  amount_cents INTEGER NOT NULL,
  note         TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Même contrainte que sur les catégories racines : SQLite considère les NULL
-- comme distincts, l'unicité du budget par défaut s'exprime donc à part.
CREATE UNIQUE INDEX budgets_unique_period ON budgets (category_id, period)
  WHERE period IS NOT NULL;
CREATE UNIQUE INDEX budgets_unique_default ON budgets (category_id)
  WHERE period IS NULL;

-- ------------------------------------------------------ Vue des lignes d'analyse
-- Clé de voûte des agrégats. Une écriture découpée produit une ligne par
-- découpe ; une écriture entière en produit une seule, la jointure externe
-- laissant les colonnes de découpe à NULL. Tout calcul écrit sur cette vue
-- traite donc le découpage correctement par construction, sans avoir à le
-- retraiter dans chaque requête.
CREATE VIEW transaction_lines AS
SELECT
  t.id                                     AS transaction_id,
  s.id                                     AS split_id,
  t.account_id                             AS account_id,
  t.value_date                             AS value_date,
  t.label                                  AS label,
  t.currency                               AS currency,
  t.is_internal_transfer                   AS is_internal_transfer,
  COALESCE(s.category_id, t.category_id)   AS category_id,
  COALESCE(s.owner, t.owner)               AS owner,
  COALESCE(s.amount_cents, t.amount_cents) AS amount_cents
FROM transactions t
LEFT JOIN transaction_splits s ON s.transaction_id = t.id;

INSERT INTO settings (key, value) VALUES ('transfer_max_days', '5');
