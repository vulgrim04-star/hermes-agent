-- Origine du solde d'un relevé.
--
-- L'export UBS réel ne porte aucune colonne de solde : le contrôle de
-- rapprochement, qui est la garantie que rien ne manque, ne peut alors pas
-- s'exécuter. Plutôt que de laisser passer un lot « sans solde », l'utilisateur
-- saisit les soldes lus dans l'e-banking et le contrôle reprend ses droits.
--
-- Distinguer les deux origines n'est pas cosmétique : un solde lu dans le
-- fichier est une donnée de la banque, un solde saisi est une déclaration. Le
-- second se corrige, le premier jamais.

ALTER TABLE import_statements
  ADD COLUMN balance_source TEXT NOT NULL DEFAULT 'fichier'
    CHECK (balance_source IN ('fichier', 'saisi'));
