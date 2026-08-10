-- Patrimoine et paramètres fiscaux.
--
-- Le budget dit ce qui entre et ce qui sort ; le patrimoine dit ce que le
-- ménage possède. Les deux se rejoignent au 31 décembre, pour la déclaration
-- de fortune du canton de Fribourg.

CREATE TABLE assets (
  id              INTEGER PRIMARY KEY,
  label           TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'autre'
                    CHECK (kind IN ('compte', 'titres', 'crypto', 'prevoyance',
                                    'immobilier', 'vehicule', 'dette', 'autre')),
  -- Une dette entre au passif : sa valorisation reste positive et c'est ce
  -- drapeau qui la fait soustraire, plutôt qu'un signe à retenir de tête.
  is_liability    INTEGER NOT NULL DEFAULT 0 CHECK (is_liability IN (0, 1)),
  -- Position adossée à un compte suivi : sa valeur se déduit alors des relevés
  -- plutôt que de se saisir tous les mois.
  account_id      INTEGER REFERENCES accounts (id) ON DELETE SET NULL,
  -- Position suivie en quantité (0,42815 BTC, 128 parts d'ETF) : la valeur se
  -- calcule alors quantité × cours, en arithmétique entière.
  tracks_quantity INTEGER NOT NULL DEFAULT 0 CHECK (tracks_quantity IN (0, 1)),
  owner           TEXT NOT NULL DEFAULT 'commun'
                    CHECK (owner IN ('p1', 'p2', 'commun')),
  currency        TEXT NOT NULL DEFAULT 'CHF',
  notes           TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order      INTEGER NOT NULL DEFAULT 100,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Un relevé par position et par mois. `value_cents` fait foi : la quantité et
-- le cours servent à l'obtenir et à le justifier, mais c'est la valeur qui est
-- reprise dans les totaux — un cours arrondi ne doit pas faire bouger un
-- patrimoine déjà arrêté.
CREATE TABLE asset_valuations (
  id               INTEGER PRIMARY KEY,
  asset_id         INTEGER NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  period           TEXT NOT NULL,               -- AAAA-MM
  value_cents      INTEGER NOT NULL,
  -- Quantité en entier à 10⁻⁸ : 0,42815 BTC vaut 42 815 000. Le satoshi est
  -- l'unité la plus fine qu'un ménage suisse ait à tenir, et un flottant la
  -- perdrait au bout de quelques additions.
  quantity_e8      INTEGER,
  unit_price_cents INTEGER,
  source           TEXT NOT NULL DEFAULT 'saisi'
                     CHECK (source IN ('saisi', 'releve')),
  noted_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (asset_id, period)
);

CREATE INDEX asset_valuations_period ON asset_valuations (period);

-- Paramètres fiscaux par année. Le plafond 3a change chaque année et n'est
-- publié qu'en fin d'année précédente : il se saisit, il ne se devine pas.
-- Aucune valeur n'est inventée pour une année non renseignée.
CREATE TABLE tax_parameters (
  year                  INTEGER PRIMARY KEY,
  pillar3a_ceiling_cents INTEGER,
  notes                 TEXT
);

INSERT INTO tax_parameters (year, pillar3a_ceiling_cents, notes)
VALUES (2025, 725800, 'Plafond 3a avec caisse de pension (LPP), OFAS');
