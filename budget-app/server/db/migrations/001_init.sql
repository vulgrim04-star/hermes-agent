-- Socle : comptes, catégories, écritures, lots d'import.
-- Tous les montants sont des centimes entiers, toutes les dates de l'ISO AAAA-MM-JJ.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE accounts (
  id            INTEGER PRIMARY KEY,
  -- IBAN normalisé (sans espaces, en majuscules) ou identifiant de compte du fichier.
  account_key   TEXT NOT NULL UNIQUE,
  label         TEXT NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'CHF',
  default_owner TEXT NOT NULL DEFAULT 'commun' CHECK (default_owner IN ('p1', 'p2', 'commun')),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE categories (
  id         INTEGER PRIMARY KEY,
  parent_id  INTEGER REFERENCES categories (id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('revenu', 'depense', 'epargne')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_system  INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1))
);

-- Unicité du nom dans la fratrie. Deux index : SQLite considère les NULL comme
-- distincts, donc la contrainte sur les racines doit être exprimée à part.
CREATE UNIQUE INDEX categories_unique_child ON categories (parent_id, name)
  WHERE parent_id IS NOT NULL;
CREATE UNIQUE INDEX categories_unique_root ON categories (name)
  WHERE parent_id IS NULL;

-- Arborescence limitée à deux niveaux : catégorie / sous-catégorie.
CREATE TRIGGER categories_depth_insert BEFORE INSERT ON categories
  WHEN NEW.parent_id IS NOT NULL
   AND (SELECT parent_id FROM categories WHERE id = NEW.parent_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'arborescence limitee a deux niveaux');
END;

CREATE TRIGGER categories_depth_update BEFORE UPDATE OF parent_id ON categories
  WHEN NEW.parent_id IS NOT NULL
   AND (SELECT parent_id FROM categories WHERE id = NEW.parent_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'arborescence limitee a deux niveaux');
END;

CREATE TABLE import_profiles (
  id                INTEGER PRIMARY KEY,
  -- Empreinte des en-têtes normalisés + séparateur : identifie un format d'export.
  signature         TEXT NOT NULL UNIQUE,
  label             TEXT NOT NULL,
  delimiter         TEXT NOT NULL,
  encoding          TEXT NOT NULL,
  header_line       INTEGER NOT NULL DEFAULT 0,
  decimal_separator TEXT NOT NULL DEFAULT 'auto'
                      CHECK (decimal_separator IN ('auto', '.', ',')),
  mapping_json      TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  used_at           TEXT
);

-- Un lot = un fichier importé. Il peut contenir plusieurs relevés : un export
-- MT940 mensuel en aligne volontiers un par période, voire par compte.
CREATE TABLE import_batches (
  id                       INTEGER PRIMARY KEY,
  filename                 TEXT NOT NULL,
  format                   TEXT NOT NULL CHECK (format IN ('csv', 'mt940')),
  status                   TEXT NOT NULL DEFAULT 'brouillon'
                             CHECK (status IN ('brouillon', 'valide')),
  file_sha256              TEXT NOT NULL,
  file_size                INTEGER NOT NULL DEFAULT 0,
  encoding                 TEXT,
  delimiter                TEXT,
  profile_id               INTEGER REFERENCES import_profiles (id) ON DELETE SET NULL,
  rows_read                INTEGER NOT NULL DEFAULT 0,
  rows_imported            INTEGER NOT NULL DEFAULT 0,
  rows_duplicate           INTEGER NOT NULL DEFAULT 0,
  rows_soft_duplicate      INTEGER NOT NULL DEFAULT 0,
  rows_error               INTEGER NOT NULL DEFAULT 0,
  -- Synthèse des relevés du lot. 'absent' : aucun solde exploitable dans le fichier.
  reconciliation_status    TEXT NOT NULL DEFAULT 'absent'
                             CHECK (reconciliation_status IN ('ok', 'ko', 'absent')),
  reconciliation_gap_cents INTEGER,
  -- Validation forcée malgré un blocage : l'écart reste inscrit, et le lot
  -- porte la marque de la décision. La preuve du rapprochement ne se perd pas.
  forced                   INTEGER NOT NULL DEFAULT 0 CHECK (forced IN (0, 1)),
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  validated_at             TEXT
);

CREATE INDEX import_batches_status ON import_batches (status, created_at DESC);

CREATE TABLE import_statements (
  id                    INTEGER PRIMARY KEY,
  batch_id              INTEGER NOT NULL REFERENCES import_batches (id) ON DELETE CASCADE,
  account_id            INTEGER REFERENCES accounts (id) ON DELETE SET NULL,
  sort_index            INTEGER NOT NULL DEFAULT 0,
  reference             TEXT,
  currency              TEXT NOT NULL DEFAULT 'CHF',
  opening_balance_cents INTEGER,
  closing_balance_cents INTEGER,
  opening_date          TEXT,
  closing_date          TEXT,
  movements_cents       INTEGER NOT NULL DEFAULT 0,
  gap_cents             INTEGER,
  status                TEXT NOT NULL DEFAULT 'absent'
                          CHECK (status IN ('ok', 'ko', 'absent'))
);

CREATE INDEX import_statements_batch ON import_statements (batch_id, sort_index);

CREATE TABLE transactions (
  id               INTEGER PRIMARY KEY,
  batch_id         INTEGER REFERENCES import_batches (id) ON DELETE CASCADE,
  account_id       INTEGER NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
  value_date       TEXT NOT NULL,
  booking_date     TEXT,
  amount_cents     INTEGER NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'CHF',
  label            TEXT NOT NULL,
  label_normalized TEXT NOT NULL,
  counterparty     TEXT,
  bank_reference   TEXT,
  category_id      INTEGER REFERENCES categories (id) ON DELETE SET NULL,
  owner            TEXT NOT NULL DEFAULT 'commun' CHECK (owner IN ('p1', 'p2', 'commun')),
  notes            TEXT,
  source           TEXT NOT NULL CHECK (source IN ('csv', 'mt940', 'manuel')),
  -- Empreinte stricte : le réimport du même fichier bute sur cette contrainte.
  fingerprint      TEXT NOT NULL UNIQUE,
  -- Clé sans libellé : sert à signaler les doublons probables, jamais à supprimer.
  soft_key         TEXT NOT NULL,
  occurrence       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX transactions_value_date ON transactions (value_date DESC);
CREATE INDEX transactions_account ON transactions (account_id, value_date DESC);
CREATE INDEX transactions_soft_key ON transactions (soft_key);
CREATE INDEX transactions_category ON transactions (category_id);
CREATE INDEX transactions_batch ON transactions (batch_id);

-- Découpage d'une écriture en plusieurs catégories (courses + produits ménagers).
-- La table existe dès le socle ; l'écran de découpage arrive avec la catégorisation.
CREATE TABLE transaction_splits (
  id             INTEGER PRIMARY KEY,
  transaction_id INTEGER NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
  category_id    INTEGER REFERENCES categories (id) ON DELETE SET NULL,
  amount_cents   INTEGER NOT NULL,
  owner          TEXT CHECK (owner IN ('p1', 'p2', 'commun')),
  note           TEXT
);

CREATE INDEX transaction_splits_transaction ON transaction_splits (transaction_id);

-- Écritures d'un lot en attente de validation. Elles ne rejoignent `transactions`
-- qu'à la validation : tant que le rapprochement n'est pas prouvé, rien n'entre
-- dans la comptabilité.
CREATE TABLE pending_transactions (
  id             INTEGER PRIMARY KEY,
  batch_id       INTEGER NOT NULL REFERENCES import_batches (id) ON DELETE CASCADE,
  statement_id   INTEGER NOT NULL REFERENCES import_statements (id) ON DELETE CASCADE,
  sort_index     INTEGER NOT NULL DEFAULT 0,
  line_number    INTEGER,
  value_date     TEXT NOT NULL,
  booking_date   TEXT,
  amount_cents   INTEGER NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'CHF',
  label          TEXT NOT NULL,
  counterparty   TEXT,
  bank_reference TEXT,
  fingerprint    TEXT NOT NULL,
  soft_key       TEXT NOT NULL,
  occurrence     INTEGER NOT NULL DEFAULT 0,
  duplicate_kind TEXT NOT NULL DEFAULT 'aucun'
                   CHECK (duplicate_kind IN ('aucun', 'strict', 'probable')),
  -- Une ligne écartée par l'utilisateur reste visible dans le lot brouillon.
  include        INTEGER NOT NULL DEFAULT 1 CHECK (include IN (0, 1))
);

CREATE INDEX pending_transactions_batch ON pending_transactions (batch_id, sort_index);

-- Lignes que le parseur n'a pas su lire, conservées telles quelles : une erreur
-- de parsing doit être visible, jamais silencieuse.
CREATE TABLE import_issues (
  id          INTEGER PRIMARY KEY,
  batch_id    INTEGER NOT NULL REFERENCES import_batches (id) ON DELETE CASCADE,
  line_number INTEGER,
  severity    TEXT NOT NULL CHECK (severity IN ('erreur', 'avertissement')),
  message     TEXT NOT NULL,
  raw         TEXT
);

CREATE INDEX import_issues_batch ON import_issues (batch_id);

INSERT INTO settings (key, value) VALUES
  ('person_1_label', 'Personne 1'),
  ('person_2_label', 'Personne 2'),
  ('household_currency', 'CHF');
