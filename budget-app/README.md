# Budget du ménage — application locale

Gestion du budget d'un ménage suisse (CHF, canton de Fribourg). Les relevés UBS
sont importés depuis un fichier **CSV** ou **SWIFT MT940** ; aucune transaction
n'est saisie deux fois, et aucun import n'est comptabilisé sans que le
rapprochement de solde ait été prouvé.

**Toutes les données restent sur cette machine.** Le serveur d'API n'écoute que
sur `127.0.0.1`, l'interface ne charge aucune ressource externe, et aucun appel
réseau sortant n'est émis.

## Démarrage

```bash
npm install
npm run dev
```

Puis <http://localhost:5173>. Deux processus sont lancés : l'API sur le port
5174 et l'interface sur le 5173, qui lui renvoie les appels `/api`.

| Commande | Effet |
|---|---|
| `npm run dev` | API + interface, en rechargement automatique |
| `npm test` | Tests des parseurs, du domaine et du pipeline |
| `npm run typecheck` | Vérification des types (serveur et interface) |
| `npm run check` | `typecheck` puis `test` |
| `npm run build` | Build de production de l'interface |

## Sauvegarde

Toute la comptabilité tient dans un fichier : **`data/budget.db`** (SQLite).
Le copier sur un disque externe suffit à en faire une sauvegarde complète ;
le remettre en place suffit à restaurer.

```bash
cp data/budget.db ~/sauvegardes/budget-$(date +%Y-%m-%d).db
```

Le mode WAL crée aussi `budget.db-wal` et `budget.db-shm` à côté. Copiez de
préférence l'application arrêtée, ou copiez les trois fichiers ensemble.

## Ce que fait l'import

1. **Format** — détecté sur le contenu, pas sur l'extension.
2. **CSV** — encodage (UTF-8 avec ou sans BOM, UTF-16, Windows-1252), séparateur
   (`;` `,` tabulation `|`) et ligne d'en-tête sous le préambule sont déduits du
   fichier. Les colonnes sont rapprochées d'un dictionnaire de synonymes
   français / allemand / anglais. Si le format n'est pas reconnu, l'écran de
   mapping s'ouvre et **le mapping validé est mémorisé** pour les fichiers
   suivants du même format.
3. **MT940** — champs `:20:` `:25:` `:28C:` `:60F:` `:61:` `:86:` `:62F:`, libellés
   multi-lignes rattachés à leur opération, fichiers multi-relevés, enveloppe
   SWIFT et fins de ligne CRLF tolérées.
4. **Déduplication** — chaque écriture reçoit une empreinte
   (compte + date de valeur + montant + libellé normalisé + rang d'occurrence).
   Réimporter le même fichier n'insère rien. Une seconde clé, sans le libellé,
   signale les **doublons probables** : la même écriture vue en CSV puis en
   MT940, à arbitrer ligne par ligne.
5. **Rapprochement** — `solde d'ouverture + mouvements = solde de clôture`, par
   relevé. En CSV, si le fichier porte une colonne de solde, le solde glissant
   est vérifié ligne à ligne, ce qui **désigne** la ligne fautive au lieu de
   constater un écart global.
6. **Diagnostic** — avant toute validation : format, encodage, lignes lues,
   écritures interprétées, lignes non lues avec leur numéro et leur contenu brut,
   doublons, contrôle de solde.
7. **Validation** — bloquée tant qu'un écart subsiste ou qu'une ligne n'a pas pu
   être lue. Le forçage reste possible ; le lot est alors marqué « forcé » et
   l'écart constaté reste inscrit en face, dans la liste des lots.
8. **Annulation** — supprimer un lot supprime les écritures qu'il a produites,
   et seulement celles-là.

## Organisation du code

```
shared/     montants (centimes entiers), dates, IBAN — partagés serveur/interface
server/
  db/       connexion SQLite, migrations numérotées (PRAGMA user_version)
  domain/   empreintes de déduplication
  import/   détection de format, parseurs CSV et MT940, pipeline d'import
  routes/   API Hono
src/        interface React (Écritures, Import, Lots, Comptes)
fixtures/   échantillons CSV et MT940 utilisés par les tests
```

Deux règles structurent le reste :

- **Les montants sont des centimes entiers.** Aucun montant ne passe par un
  flottant : un centime d'erreur invalide un rapprochement.
- **Les parseurs ne touchent pas la base.** Ils rendent un résultat inerte que le
  pipeline dédoublonne, rapproche et persiste — ce qui les rend testables sur des
  échantillons sans monter de base.

## Limites connues

- Les **fixtures sont synthétiques**, écrites d'après la spécification SWIFT et
  les formats UBS courants. Un véritable export réservera des surprises :
  c'est exactement ce que l'écran de diagnostic sert à révéler. Les parseurs
  seront ajustés dessus.
- **Pas de conversion de devise.** Une écriture en EUR est conservée telle
  quelle et n'entre pas dans les totaux CHF.
- Un montant à trois décimales sans indication (`1.005`) est lu comme un groupe
  de milliers (1'005), un relevé bancaire portant deux décimales. Le séparateur
  décimal peut être imposé par un profil d'import quand le doute existe.
- Les étapes suivantes — catégorisation automatique, budgets, tableaux de bord,
  patrimoine, exports — ne sont pas encore là. Le schéma les anticipe
  (`transaction_splits`, arborescence de catégories sur deux niveaux, types
  revenu / dépense / épargne).
