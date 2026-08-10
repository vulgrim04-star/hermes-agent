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

## Catégorisation

- **Moteur de règles.** Une règle associe un motif de libellé à une catégorie.
  Un motif *contient* est comparé au libellé normalisé (majuscules, sans accents
  ni ponctuation) ; un motif *regex* s'applique au libellé brut, insensible à la
  casse. Trois filtres facultatifs évitent les faux positifs : sens du mouvement,
  compte, et attribution à poser en même temps. La priorité croissante départage
  deux règles qui correspondent : la plus basse l'emporte.
- **Une règle comble les vides.** Elle ne touche jamais une catégorie posée à la
  main, ni une écriture déjà découpée. Elle s'applique automatiquement aux
  écritures d'un lot au moment de sa validation, et rétroactivement aux
  non catégorisées quand vous la créez.
- **Apprentissage.** Depuis la file de révision, `R` propose la règle
  correspondant à l'écriture : le motif est déduit du libellé en retirant
  l'appareil bancaire, les mois et les nombres — « Paiement carte COOP PRONTO
  GENÈVE » donne `COOP PRONTO`. Il est modifiable, et le nombre d'écritures que
  la règle prendrait est recalculé à chaque frappe, **avant** de la poser.
- **File de révision.** L'écran de fin de mois : `↑` `↓` changent de ligne,
  `1` à `9` posent l'une des neuf catégories les plus utilisées, une lettre
  ouvre la recherche, `Entrée` valide, `D` découpe, `R` propose la règle.
- **Découpage.** Une écriture peut être ventilée entre plusieurs catégories
  (un passage en grande surface qui mêle alimentation et produits ménagers). Le
  reliquat est affiché en permanence et l'enregistrement reste fermé tant qu'il
  n'est pas nul, côté écran comme côté serveur.

## Transferts internes

Un virement du compte courant vers le compte d'épargne apparaît deux fois quand
les deux comptes sont importés : en débit d'un côté, en crédit de l'autre. Sans
traitement, il gonfle simultanément les dépenses et les revenus.

L'application apparie automatiquement les mouvements opposés de même montant
entre deux comptes distincts, à quelques jours d'intervalle (5 par défaut,
réglable). La paire est **proposée**, jamais imposée : deux mouvements opposés
peuvent être un remboursement entre le ménage et un tiers. Une paire confirmée
sort des revenus et des dépenses sans disparaître du journal ; une paire écartée
est mémorisée comme telle et n'est plus reproposée.

## Budgets et tableau de bord

- **Budget par défaut et dérogation.** Chaque catégorie porte un budget mensuel,
  et facultativement une dérogation pour un mois donné. Le budget applicable est
  la dérogation si elle existe, le budget mensuel sinon — les primes d'assurance
  et les acomptes d'impôts ne tombent pas tous les mois.
- **Convention retenue.** *Reste à vivre = revenus − dépenses − épargne.*
  L'épargne est un emploi du revenu, pas une consommation : elle a sa ligne
  propre, elle est déduite, et le taux d'épargne la rapporte aux revenus.
- **Ce qui n'est pas catégorisé reste visible.** Une écriture sans catégorie est
  classée par son signe pour ne pas disparaître des totaux, mais elle est comptée
  à part et annoncée en tête du tableau de bord. Un tableau de bord ne doit
  jamais être faux en silence sur ce qui n'a pas encore été affecté.
- **Découpage et agrégats.** Une écriture ventilée est comptée dans chacune de
  ses catégories et une seule fois au total — la vue SQL `transaction_lines` rend
  une ligne par découpe, ce qui rend tout agrégat correct par construction.

## Organisation du code

```
shared/     montants (centimes entiers), dates, IBAN, types — serveur et interface
server/
  db/       connexion SQLite, migrations numérotées (PRAGMA user_version)
  domain/   empreintes, règles, transferts, découpage, agrégats du tableau de bord
  import/   détection de format, parseurs CSV et MT940, pipeline d'import
  routes/   API Hono
src/        interface React (Tableau de bord, Écritures, Révision, Budgets,
            Import, Réglages)
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
- **Pas de vue annuelle ni de patrimoine** pour l'instant : ni les douze mois en
  colonnes, ni le suivi des positions ETF / Bitcoin / 3a, ni l'état au 31.12 pour
  la déclaration de fortune. Ni exports CSV/Excel, ni sauvegarde depuis
  l'interface — la sauvegarde se fait en copiant `data/budget.db`.
- Le **motif de règle proposé** est une heuristique : elle retire l'appareil
  bancaire et les mois, mais « Retrait Bancomat Fribourg » se réduit à
  `FRIBOURG`, faute de commerçant dans le libellé. Le motif reste modifiable
  avant création, et la portée annoncée montre tout de suite si la règle est
  trop large.
- La **détection des transferts** apparie sur le montant, la date et le compte.
  Deux virements de même montant entre les deux mêmes comptes à quelques jours
  d'intervalle peuvent donc être appariés en croix ; la confirmation étant
  manuelle, l'erreur se voit avant d'être enregistrée.
