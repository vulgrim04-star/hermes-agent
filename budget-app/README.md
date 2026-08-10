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

Depuis **Réglages → Export & sauvegarde**, « Créer une sauvegarde » en écrit une
copie datée dans `sauvegardes/budget-AAAA-MM-JJ-HHmm.db`, téléchargeable pour
la porter sur un disque externe. La copie passe par la sauvegarde en ligne de
SQLite : copier `budget.db` à la main pendant que l'application tourne donnerait
une base tronquée, en mode WAL, sans que rien ne le signale avant le jour où
elle servirait.

La restauration remplace la base en place, après confirmation explicite et
**après avoir sauvegardé l'état courant** sous un fichier `-securite` : aucune
manœuvre n'est sans retour. Le dossier `sauvegardes/` n'entre pas dans le dépôt.

Application arrêtée, une copie des trois fichiers `budget.db`, `budget.db-wal`
et `budget.db-shm` reste valable.

## Ce que fait l'import

1. **Format** — détecté sur le contenu, pas sur l'extension.
2. **CSV** — encodage (UTF-8 avec ou sans BOM, UTF-16, Windows-1252), séparateur
   (`;` `,` tabulation `|`) et ligne d'en-tête sous le préambule sont déduits du
   fichier. Les colonnes sont rapprochées d'un dictionnaire de synonymes
   français / allemand / anglais. Si le format n'est pas reconnu, l'écran de
   mapping s'ouvre et **le mapping validé est mémorisé** pour les fichiers
   suivants du même format.
3. **Export UBS réellement observé** — sept colonnes : date de transaction,
   « Numéro de compte ou de carte », description, « Revenu ou dépense », montant,
   monnaie, catégorie. Trois conséquences :
   - **Un fichier, plusieurs comptes.** Un export mêle comptes bancaires et
     cartes (`****7648`) ; chaque ligne est rattachée au compte qu'elle porte, et
     un relevé est ouvert par compte. Sans cela, les achats par carte *et* leur
     règlement compteraient tous deux en dépense. Les règlements deviennent des
     paires opposées entre deux comptes du ménage, que la détection de transferts
     propose à confirmation.
   - **Aucune colonne de solde.** Le rapprochement ne peut pas s'exécuter seul :
     l'écran de diagnostic permet de saisir, par compte, le solde d'ouverture et
     le solde de clôture lus dans l'e-banking. L'ouverture est pré-remplie depuis
     la dernière clôture connue du compte, comme un solde à nouveau.
   - **La colonne « Revenu ou dépense » ne décide de rien** : le montant fait
     foi. Une contradiction entre le sens annoncé et le signe est signalée, ligne
     par ligne, et l'écriture est conservée.
4. **MT940** — champs `:20:` `:25:` `:28C:` `:60F:` `:61:` `:86:` `:62F:`, libellés
   multi-lignes rattachés à leur opération, fichiers multi-relevés, enveloppe
   SWIFT et fins de ligne CRLF tolérées.
5. **Déduplication** — chaque écriture reçoit une empreinte
   (compte + date de valeur + montant + libellé normalisé + rang d'occurrence).
   Réimporter le même fichier n'insère rien. Une seconde clé, sans le libellé,
   signale les **doublons probables** : la même écriture vue en CSV puis en
   MT940, à arbitrer ligne par ligne.
6. **Rapprochement** — `solde d'ouverture + mouvements = solde de clôture`, par
   relevé. En CSV, si le fichier porte une colonne de solde, le solde glissant
   est vérifié ligne à ligne, ce qui **désigne** la ligne fautive au lieu de
   constater un écart global.
7. **Diagnostic** — avant toute validation : format, encodage, lignes lues,
   écritures interprétées, lignes non lues avec leur numéro et leur contenu brut,
   doublons, contrôle de solde.
8. **Validation** — bloquée tant qu'un écart subsiste ou qu'une ligne n'a pas pu
   être lue. Le forçage reste possible ; le lot est alors marqué « forcé » et
   l'écart constaté reste inscrit en face, dans la liste des lots.
9. **Annulation** — supprimer un lot supprime les écritures qu'il a produites,
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
- **Catégories de la banque.** UBS classe déjà chaque écriture, en une
  vingtaine de libellés. Une table de correspondance, pré-remplie et éditable
  dans *Réglages → Catégories de la banque*, les traduit vers le plan du ménage.
  Elle s'applique **après** vos règles et ne comble que les vides. Les libellés
  trop vagues (« Autres transactions ») sont volontairement laissés sans
  correspondance : une écriture sans catégorie remonte dans la file de révision,
  une écriture mal catégorisée n'y remonte jamais. « Factures de carte de crédit »
  et « Transferts entre comptes » sont traités en transfert interne — ce ne sont
  pas des dépenses. Sur un export réel, cette table classe d'emblée 629 écritures
  sur 783.
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

## Vue annuelle

Le tableau de bord a deux échelles. Le **mois** pour piloter, l'**année** pour
comprendre : une prime semestrielle, un acompte trimestriel ou un 13e salaire ne
se lisent pas sur trente jours. Douze mois en colonnes, par catégorie, avec
totaux et moyennes.

Les moyennes divisent par douze, pas par les mois qui portent des écritures : un
ménage qui a importé huit mois ne doit pas lire une moyenne qui le flatte de
moitié. Une année précédente sans écriture est annoncée comme absente, non comme
une année à zéro.

Les deux vues partagent `server/domain/ledger.ts` : il n'y a **qu'une seule
définition du reste à vivre** dans le code.

## Patrimoine

Le budget dit ce qui entre et ce qui sort ; l'écran **Patrimoine** dit ce que le
ménage possède, dettes déduites.

- **Les comptes suivis se déduisent, ils ne se saisissent pas.** La valeur part
  du solde de clôture rapproché le plus proche, auquel s'ajoutent les mouvements
  postérieurs — ou dont se retranchent les mouvements suivants quand le seul
  relevé soldé est postérieur. Un compte avant son premier mois importé est
  *inconnu*, pas à zéro.
- **Les quantités sont des entiers à 10⁻⁸.** 0,42815 BTC × 58'432.15 se calcule
  `quantité × cours / 10⁸`, arrondi au centime une seule fois. La valeur stockée
  fait foi : un cours arrondi ne doit pas faire bouger un patrimoine déjà arrêté.
- **Un mois non saisi reporte la dernière valeur connue**, et le dit.
- **Une dette se saisit positive** et se soustrait par son propre drapeau, pas
  par un signe à retenir.
- **État au 31 décembre**, la date que retient la déclaration de fortune
  fribourgeoise, avec l'origine de chaque chiffre.

**Pilier 3a.** Versements de l'année par personne, plafond, reste à verser et
jours restants. Le plafond change chaque année et **ne se devine pas** : tant
qu'il n'est pas saisi, l'écran le dit et n'affiche aucun reste à verser. 2025 est
pré-rempli à CHF 7'258.00 (avec caisse de pension).

## Export

*Réglages → Export & sauvegarde*, filtrable par période, compte, catégorie et
personne :

- **CSV** en UTF-8 **avec BOM** et séparateur **point-virgule**. Sans le BOM,
  Excel lit le fichier en ANSI et les accents sautent ; avec la virgule, il
  refuse de découper les colonnes sur une machine configurée en français de
  Suisse.
- **Classeur `.xlsx`** à cellules typées : une date exportée en texte ne se trie
  pas, un montant en texte ne s'additionne pas.

Dans les deux cas, une écriture ventilée sort en autant de lignes que de
découpes : le total d'un export est le total du journal, sans double comptage.

## Organisation du code

```
shared/     montants (centimes entiers), dates, IBAN, types — serveur et interface
server/
  db/       connexion SQLite, migrations numérotées (PRAGMA user_version)
  domain/   empreintes, règles, transferts, découpage, journal partagé (ledger),
            agrégats mensuels et annuels, patrimoine, 3a, exports, sauvegarde
  import/   détection de format, parseurs CSV et MT940, pipeline d'import
  routes/   API Hono
src/        interface React (Tableau de bord mois/année, Écritures, Révision,
            Budgets, Patrimoine, Import, Réglages)
fixtures/   échantillons CSV et MT940 utilisés par les tests
```

Deux règles structurent le reste :

- **Les montants sont des centimes entiers.** Aucun montant ne passe par un
  flottant : un centime d'erreur invalide un rapprochement.
- **Les parseurs ne touchent pas la base.** Ils rendent un résultat inerte que le
  pipeline dédoublonne, rapproche et persiste — ce qui les rend testables sur des
  échantillons sans monter de base.

## Limites connues

- Les **fixtures ne contiennent aucune donnée réelle.** Celles du CSV UBS
  reproduisent le format d'un export authentique — mêmes en-têtes, même
  séparateur, mêmes guillemets, même ordre décroissant — avec des IBAN et des
  écritures inventés. Les fixtures MT940, elles, restent écrites d'après la
  spécification SWIFT : un vrai relevé MT940 réservera des surprises, que
  l'écran de diagnostic est là pour révéler.
- **Pas de conversion de devise.** Une écriture en EUR est conservée telle
  quelle et n'entre pas dans les totaux CHF.
- Un montant à trois décimales sans indication (`1.005`) est lu comme un groupe
  de milliers (1'005), un relevé bancaire portant deux décimales. Le séparateur
  décimal peut être imposé par un profil d'import quand le doute existe.
- **Les cours ne sont pas récupérés automatiquement**, et ne le seront pas :
  aucun appel réseau ne part de cette application. Le cours d'un ETF ou du
  Bitcoin se saisit, une fois par mois, à côté de la quantité.
- **Le plafond 3a de l'année en cours n'est pas pré-rempli** (seul 2025 l'est) :
  il est publié en fin d'année précédente et se saisit dans l'écran Patrimoine.
- **Le patrimoine ignore les devises étrangères** : une position en EUR est
  saisie pour sa contre-valeur en CHF, la conversion restant à la charge de
  l'utilisateur.
- Le **motif de règle proposé** est une heuristique : elle retire l'appareil
  bancaire et les mois, mais « Retrait Bancomat Fribourg » se réduit à
  `FRIBOURG`, faute de commerçant dans le libellé. Le motif reste modifiable
  avant création, et la portée annoncée montre tout de suite si la règle est
  trop large.
- La **détection des transferts** apparie sur le montant, la date et le compte.
  Deux virements de même montant entre les deux mêmes comptes à quelques jours
  d'intervalle peuvent donc être appariés en croix ; la confirmation étant
  manuelle, l'erreur se voit avant d'être enregistrée.
