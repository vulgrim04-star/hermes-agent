# Budget du ménage

Application de gestion du budget d'un ménage suisse (CHF, canton de Fribourg), en ligne, avec
compte personnel. Elle importe un relevé bancaire **CSV ou SWIFT MT940**, le dédoublonne, prouve
le rapprochement avant de comptabiliser quoi que ce soit, catégorise les écritures, rend le mois
et l'année, et suit le patrimoine jusqu'à l'état au 31 décembre.

Même pile que Cat's Eyes Studio : **Vite + React** servi par **Vercel**, **Supabase** pour
l'authentification et les données. Le déploiement se fait tout seul à chaque `git push`.

---

## Sans compte, sans serveur — c'est le mode par défaut

L'application s'ouvre directement sur le journal. Vos écritures sont enregistrées **dans ce
navigateur** et n'en sortent pas : aucun compte à créer, aucune requête réseau, rien à configurer.

C'est ce que demande le cahier des charges — *« Cloud sync : hors scope, tout reste local »* — et
c'est aussi ce qui rend l'import robuste. Il y avait auparavant trois portes avant d'atteindre le
premier écran : une configuration à valider, une session à attendre, une connexion à réussir.
Chacune pouvait rester fermée, et l'écran d'import devenait alors inatteignable.

Corollaire à connaître : les écritures vivent sur **cet appareil**. Un autre téléphone ne les
verra pas, et un navigateur nettoyé les emporterait. *Réglages → Export et sauvegarde* en fait une
copie `.json` rechargeable — c'est la sauvegarde à faire de temps en temps.

La synchronisation par compte reste disponible sur `/connexion`, pour qui veut retrouver ses
écritures depuis plusieurs appareils. Elle est facultative.

---

## Le projet Supabase est déjà câblé

L'application pointe sur le projet du ménage sans configuration : l'URL et la clé publishable
sont dans [`src/lib/supabase.public.js`](src/lib/supabase.public.js). Ces deux valeurs partent
dans le bundle de toute façon — les ranger dans un secret ne protégerait rien. **Ce qui protège
les données, c'est la RLS**, et elle seule.

D'où l'ordre à respecter : exécuter [`supabase/schema.sql`](supabase/schema.sql) puis
[`supabase/policies.sql`](supabase/policies.sql) dans le SQL Editor **avant** de publier le site.
`schema.sql` active la RLS dans le même souffle qu'il crée la table, ce qui la ferme à tous par
défaut ; les policies l'ouvrent ensuite au seul titulaire.

Une variable de construction (`SUPABASE_URL`, `VITE_SUPABASE_URL`…) l'emporte sur ces valeurs :
pointer un autre projet ne demande pas de toucher au code.

---

## Mise en ligne, une fois

Deux étapes. Rien à installer, et aucune clé à recopier si vous prenez le chemin A.

### 1. Vercel

[vercel.com/new](https://vercel.com/new) → importer le dépôt **`hermes-agent`**.

⚠️ **Régler « Root Directory » sur `budget-menage`.** L'application vit dans un sous-dossier ;
sans ce réglage, Vercel construirait la racine et ne trouverait rien. Le champ est sur l'écran
d'import, sous « Configure Project » → *Edit* en face de Root Directory. Le reste se détecte tout
seul : Vercel reconnaît Vite.

Puis, pour les identifiants Supabase, au choix :

**A. L'intégration Supabase — rien à recopier.** Onglet *Integrations* du projet Vercel →
*Supabase* → *Add integration* → créer ou relier un projet. Elle injecte `SUPABASE_URL` et
`SUPABASE_ANON_KEY` toute seule, et la construction sait les lire (voir `vite.config.js`).
Redéployer une fois l'intégration ajoutée.

**B. À la main.** *Project Settings → Environment Variables*, deux valeurs prises dans
Supabase → *Project Settings → API* :

| Variable | Valeur |
|---|---|
| `VITE_SUPABASE_URL` | l'URL du projet (`https://xxxx.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | la clé **anon / public** |

> ⚠️ Une variable est figée dans le bundle **au moment de la construction**. L'ajouter après un
> déploiement n'a aucun effet tant qu'on n'a pas redéployé.

**La clé `service_role` ne peut pas entrer**, quel que soit le nom sous lequel on la poserait :
la construction lit le rôle inscrit dans le jeton et **échoue** plutôt que de la publier. Elle
contourne toutes les règles d'accès ; sa place est côté serveur, et cette application n'en a pas.

### 2. Supabase : la table et ses règles

Dans le **SQL Editor** du projet Supabase, exécuter dans cet ordre :

1. [`supabase/schema.sql`](supabase/schema.sql) — la table ;
2. [`supabase/policies.sql`](supabase/policies.sql) — les règles d'accès.

Sans la seconde, **la table serait lisible par n'importe quel porteur de la clé publique** — et
cette clé est dans le bundle, par construction. Voir [`supabase/README.md`](supabase/README.md)
pour ce que chaque règle garantit.

Dans **Authentication → URL Configuration**, mettre l'adresse Vercel en *Site URL* : c'est elle
que suivront les liens de confirmation et de réinitialisation.

### 3. Le compte

Ouvrir l'adresse du projet, « Pas encore de compte ? En créer un », confirmer l'adresse par le
lien reçu, se connecter.

---

## Variante : GitHub Pages, sans créer de compte Vercel

Le dépôt porte un workflow ([`.github/workflows/budget-menage-pages.yml`](../.github/workflows/budget-menage-pages.yml))
qui construit et publie ce dossier à chaque poussée. Il n'y a rien à installer : la construction
tourne sur les machines de GitHub.

**Une seule chose à faire, une fois** : *Settings → Pages → Build and deployment → Source :*
**GitHub Actions**. Activer Pages demande un droit d'administration sur le dépôt, qu'un jeton de
workflow n'a pas — le workflow ne peut donc pas le faire à votre place. Il le vérifie au démarrage
et s'arrête en le disant plutôt que de renvoyer l'erreur brute de l'API.

Relancer ensuite depuis *Actions → « Budget ménage — Pages » → Run workflow*. L'adresse publiée est
`https://<compte>.github.io/<dépôt>/`.

La connexion fonctionne sans rien poser : les identifiants du projet sont dans le code (voir
plus haut). Il reste **une chose à ne pas oublier** — dans Supabase, *Authentication → URL
Configuration*, mettre l'adresse publiée en **Site URL**. Sans elle, le lien de confirmation
envoyé à l'inscription renvoie vers `http://localhost:3000` : le compte est bien confirmé, mais
la page d'arrivée n'existe pas.

Pour pointer un autre projet, poser `SUPABASE_URL` et `SUPABASE_ANON_KEY` en *secrets de dépôt*
(*Settings → Secrets and variables → Actions*) et relancer le workflow — une variable de
construction n'est lue qu'à ce moment-là.

> Pages sert le site sous `/<dépôt>/` et non à la racine : la base est réglée à la construction
> (`BASE_PATH`), et `index.html` est recopié en `404.html` parce que Pages ne réécrit pas les URL —
> sans quoi un lien profond comme `/ecritures` tomberait sur le 404 de GitHub au lieu de démarrer
> l'application.

---

## Essayer sans rien brancher

`https://<adresse>/?demo=1` ouvre l'application **sans compte** : les écritures restent dans le
navigateur et ne partent nulle part. Utile pour l'essayer avant l'étape 1, ou pour travailler sur
un poste où l'on ne veut rien déposer en ligne. Un bandeau le rappelle en permanence.

---

## En local

```bash
npm install
cp .env.example .env        # y mettre les deux valeurs Supabase
npm run dev                 # http://localhost:5173
npm test                    # 253 tests
```

---

## Ce que fait l'import

1. **Format déduit du contenu**, jamais de l'extension : un MT940 s'appelle volontiers `.txt`,
   et un CSV renommé `.sta` reste un CSV.
   - **CSV** — encodage (UTF-8 avec ou sans BOM, UTF-16, Windows-1252), séparateur
     (`;` `,` tabulation `|`), ligne d'en-tête sous le préambule, colonnes rapprochées d'un
     dictionnaire de synonymes français / allemand / anglais.
   - **MT940** — champs `:20:` `:25:` `:60F:` `:61:` `:86:` `:62F:`, libellés multi-lignes
     rattachés à leur opération, forme structurée `?20?32` dépliée, enveloppe SWIFT tolérée,
     extournes `RC` / `RD` traitées comme les inversions qu'elles sont. **Un MT940 porte ses
     soldes** : le rapprochement s'y exécute sans rien saisir.
2. **Un relevé par compte.** Un export UBS mélange comptes bancaires et cartes (`****7648`) dans
   une seule colonne. Chaque ligne est rattachée au compte qu'elle porte, sans quoi les achats
   par carte **et** leur règlement compteraient tous deux en dépense.
3. **Déduplication.** Chaque écriture reçoit une empreinte : compte + date + montant + libellé
   normalisé + rang d'occurrence au sein du relevé. Réimporter le même fichier n'ajoute rien,
   et deux lignes strictement identiques restent deux écritures — parce qu'elles le sont.
4. **Rapprochement.** `ouverture + mouvements = clôture`, par relevé. Un MT940 se rapproche
   tout seul ; l'export CSV d'UBS ne portant aucune colonne de solde, les deux soldes s'y
   saisissent depuis l'e-banking. Renseignés, le contrôle s'exécute et **bloque la validation**
   tant qu'il ne boucle pas. Le forçage reste possible, et l'écart reste inscrit en face.
5. **Diagnostic avant toute écriture** : lignes lues, lignes non lues avec leur numéro, sens
   contradictoires, comptes trouvés. Rien n'est comptabilisé avant validation.

## Catégorisation

- **Les règles d'abord.** Un motif contenu dans le libellé pose une catégorie. La portée est
  annoncée avant de créer la règle, et une règle ne touche jamais une catégorie posée à la main.
- **La banque ensuite.** Les catégories que la banque livre déjà sont traduites vers le plan du
  ménage par une table éditable. Les libellés ambigus (« Autres transactions ») sont laissés
  sans correspondance : une écriture sans catégorie remonte en révision, une écriture mal
  classée n'y remonte jamais. Sur un export réel, cette table classe 629 écritures sur 783.
- **Les transferts internes** — règlements de carte, virements entre comptes — sont **proposés**
  à l'appairage, jamais imposés : deux mouvements opposés peuvent être un remboursement. Une
  paire confirmée sort des revenus et des dépenses sans disparaître du journal.

## Patrimoine

Le budget dit ce qui entre et ce qui sort ; l'écran **Patrimoine** dit ce que le ménage possède,
dettes déduites.

- **Les comptes suivis se déduisent, ils ne se saisissent pas.** La valeur part du solde de
  clôture rapproché le plus proche, auquel s'ajoutent les mouvements postérieurs — ou dont se
  retranchent les mouvements suivants quand le seul relevé soldé est postérieur. Un compte avant
  son premier relevé est *inconnu*, pas à zéro.
- **Les quantités sont des entiers à 10⁻⁸.** 0,42815 BTC × 58'432.15 se calcule
  `quantité × cours / 10⁸`, arrondi au centime une seule fois. La valeur stockée fait foi : un
  cours arrondi ne doit pas faire bouger un patrimoine déjà arrêté.
- **Un mois non saisi reporte la dernière valeur connue**, et le dit.
- **Une dette se saisit positive** et se soustrait par sa nature, pas par un signe à retenir.
- **État au 31 décembre**, la date que retient la déclaration de fortune fribourgeoise, avec
  l'origine de chaque chiffre — saisi, déduit d'un relevé, ou reporté.

**Pilier 3a.** Versements de l'année, plafond, reste à verser, jours restants. Le plafond change
chaque année et **ne se devine pas** : tant qu'il n'est pas saisi, l'écran le dit et n'affiche
aucun reste à verser. 2025 est pré-rempli à CHF 7'258.00.

### Ce qui fait bouger le patrimoine

Le montant seul ne se pilote pas. `src/lib/patrimoine.js` en donne la lecture :

- **Décomposition de la variation** — `variation = épargne + valorisation`. L'épargne se mesure au
  journal (revenus moins consommation, les mouvements d'épargne étant des déplacements et non des
  dépenses) ; la valorisation est le **reste**, ce que les flux du ménage n'expliquent pas. C'est
  la distinction qui dit si le ménage s'enrichit ou si le marché travaille pour lui. La série
  **ne s'ouvre pas avant la première valorisation connue** : sans cela, une hypothèque saisie
  aujourd'hui sortirait comme une perte de 400'000 sur une fenêtre de deux ans. Un mois portant
  une position non renseignée est signalé — ce qui manque au patrimoine se retrouverait sinon en
  valorisation.
- **Allocation par classe d'actifs**, et l'écart à une cible **en francs** : « 4'200 de titres à
  acheter » se décide, « 58 % au lieu de 65 % » se contemple. Les dettes sont tenues hors de
  l'anneau. Des cibles qui ne totalisent pas 100 % restent justes classe par classe, et l'écran le
  dit.
- **Hypothèque : la charge théorique**, celle que la banque recalcule — intérêts au **taux de
  calcul de 5 %** et non au taux payé, 1 % d'entretien, amortissement du 2e rang sur quinze ans —
  à tenir sous un tiers du revenu brut. Avec la simulation d'un amortissement extraordinaire, et
  l'arbitrage entre amortissement direct et 3a nanti. Aucun paramètre par défaut : taux marginal,
  rendement et impôt de retrait dépendent de la commune et du barème, et orientent une décision à
  cent mille francs.
- **Taux d'épargne** constaté sur douze mois — le mois en cours écarté, faute de quoi un mois
  arrêté au 7 porterait une semaine de dépenses et un salaire entier — et sa projection à 5 et
  10 ans, qui sépare toujours ce qui a été versé de ce que le rendement a produit.

## Exports

*Réglages → Export et sauvegarde* :

- **Classeur `.xlsx` à cellules typées** — une date exportée en texte ne se trie pas, un montant
  en texte ne s'additionne pas. Le classeur est écrit à la main (`src/lib/xlsx.js`, une archive
  ZIP de quelques XML) : les bibliothèques du marché pèsent près d'un mégaoctet pour ce qu'on en
  fait ici, et ce poids serait téléchargé à chaque visite.
- **CSV** en UTF-8 avec BOM et point-virgule — Excel l'ouvre sans assistant d'import.
- **État des positions au 31.12** de l'année close, la pièce à joindre à la déclaration de
  fortune. Une dette en sort négative, pour que la colonne s'additionne en fortune nette.
- **Sauvegarde `.json`** rechargeable, qui emporte tout : écritures, règles, correspondances,
  positions et valorisations.

## Conventions de calcul

- **Les montants sont des centimes entiers.** Aucun ne passe par un flottant : un centime
  d'erreur invalide un rapprochement.
- **Reste à vivre = revenus − dépenses − épargne.** L'épargne est un emploi du revenu, pas une
  consommation. Cette définition n'existe qu'une fois dans le code (`src/lib/ledger.js`), pour
  que le mois et l'année ne puissent pas diverger.
- **Ce qui n'est pas catégorisé reste dans les totaux**, classé par son signe, et compté à part.
  Un tableau de bord ne doit jamais être faux en silence sur ce qui n'a pas encore été affecté.
- **Les moyennes annuelles divisent par douze**, pas par les mois mouvementés : un ménage qui a
  importé huit mois ne doit pas lire une moyenne qui le flatte de moitié.

## Où vivent vos données

Dans votre projet Supabase, dans une ligne qui vous appartient — `auth.uid() = user_id`, sur les
quatre opérations, sans aucune exception ni lecture anonyme. Le fichier que vous importez, lui,
n'est jamais transmis : il est lu par le navigateur, et seules les écritures qui en sortent
rejoignent votre compte.

*Réglages → Export et sauvegarde* télécharge à tout moment l'intégralité du journal en `.json`
(rechargeable) et les écritures en `.csv` (UTF-8 avec BOM, point-virgule : Excel l'ouvre sans
assistant d'import).

## L'interface

Mise en page **façon Finary**, pensée pour le téléphone d'abord.

- **Sombre par défaut**, quel que soit le réglage du téléphone : c'est un parti pris d'identité,
  pas une conséquence des préférences système. Conséquence pour la feuille de style : `:root` nu
  porte la palette sombre, le clair ne vaut que sous `[data-theme="light"]`, et **aucune couleur
  ne dépend de `prefers-color-scheme`** — c'est le script du thème qui stampe la racine. Il
  n'existe donc aucun état où le texte d'un thème se poserait sur le fond de l'autre.
- **Le vert menthe dit deux choses qui vont dans le même sens** : ce qui est actionnable, et ce
  qui est positif. Le rouge corail dit l'inverse. Un débit ordinaire, lui, garde la couleur du
  texte — un relevé n'est pas rouge parce qu'on a fait des courses.
- **Un seul chiffre domine par écran** — le reste à vivre sur le budget, le patrimoine net sur le
  patrimoine — avec sa variation en pastille, **en francs et en pourcentage** : le montant dit
  combien, le pourcentage dit si c'est beaucoup.
- **Une aire dégradée sans axes**, et le chiffre exact au bout du doigt : on ne lit jamais une
  valeur sur une graduation, on la lit en pointant la courbe. Le sélecteur de période grise les
  durées plus longues que l'historique disponible, au lieu de rendre deux fois la même courbe.
- **Une barre segmentée** plutôt qu'un anneau pour les répartitions : douze pixels de haut contre
  cent quatre-vingts, et un petit poste y reste visible.
- **Cinq onglets** — Budget, Écritures, Tiers, Patrimoine, Plus. Révision, Import et Réglages
  vivent sous « Plus », avec la pastille des écritures à trancher reportée sur l'onglet.
- **Une pastille ronde par ligne**, dont la teinte est déduite du nom : le même tiers garde sa
  couleur d'une session à l'autre, sans qu'aucun logo ne soit téléchargé.
- **Un œil masque tous les montants** d'un geste. Le flou est posé par la feuille de style sur les
  classes qui portent des chiffres : aucun montant ne peut lui échapper par oubli.

## Comptes et soldes

*Plus → Comptes.* L'écran qui débloque les autres.

L'export CSV d'UBS **ne porte aucun solde** : sans point de départ, le patrimoine ne peut rien
déduire d'un compte suivi, et la prévision de trésorerie refuse — à raison — de projeter. Un seul
chiffre relevé sur l'application de la banque, saisi ici avec sa date, ouvre les deux : mesuré sur
l'export réel, un solde saisi fait passer la trésorerie de « indisponible » à une projection à
trois mois.

- **Le cumul des mouvements importés n'est pas un solde**, et l'écran ne les met jamais sur le même
  plan : il ignore tout ce qui précède le premier relevé.
- Un solde saisi est rangé comme un relevé sans mouvements — les écritures postérieures s'y
  ajoutent, celles qui précèdent s'en retranchent. Deux saisies à la même date se remplacent :
  c'est une correction, pas une seconde vérité.
- **Le libellé se renomme, la clé jamais** : c'est elle qui rattache les écritures, les relevés et
  les positions du patrimoine.
- Un compte se crée aussi à la main — la caisse en espèces, une banque qui n'exporte rien. Sa clé
  est préfixée `MANUEL-`, pour qu'on ne la confonde jamais avec celle d'un relevé.

## Découpage d'écriture

Un passage à la Migros à 148.50 dont 30.00 sont un article de ménage n'est pas une dépense
d'alimentation de 148.50. Une écriture se **répartit** entre plusieurs catégories, et le journal
rend alors **une ligne par part** — les totaux, les postes, le camembert et les budgets suivent
sans qu'aucun d'eux ait été modifié.

La règle est absolue : **la somme des parts vaut l'écriture, au centime**. Le reste à répartir est
affiché en permanence et l'enregistrement reste fermé tant qu'il n'est pas nul, parce qu'une
répartition qui ne boucle pas ferait apparaître ou disparaître de l'argent dans tous les totaux
sans qu'aucun écran puisse le signaler. Un bouton « reste » prend le solde, pour éviter la
soustraction de tête — l'endroit exact où l'on se trompe.

Une écriture répartie n'a plus de catégorie propre : ce sont ses parts qui la portent. Elle sort
donc de la file de révision, et ni les règles ni la correspondance de la banque ne viennent
reposer une catégorie par-dessus. Les exports sortent une ligne par part, avec une colonne
« Part » (`1/2`) pour qu'un total fait dans Excel tombe juste.

## Enveloppes proposées

*Plus → Réglages → Budgets par catégorie → « Proposer des enveloppes d'après l'historique ».*

Poser vingt budgets à la main demande vingt chiffres qu'on n'a pas en tête — c'est la raison pour
laquelle un budget reste vide. Le journal les connaît :

- une catégorie **régulière** (présente au moins un mois sur deux) est proposée à sa **médiane**,
  pas à sa moyenne : un mois de vacances ne doit pas gonfler l'enveloppe des onze autres ;
- une catégorie **irrégulière** — le dentiste, l'entretien de la voiture — est **lissée** sur la
  période : sa médiane mensuelle n'aurait aucun sens, et une enveloppe à zéro non plus ;
- le mois en cours est écarté, sans quoi un mois arrêté au 7 ferait proposer des enveloppes deux
  fois trop petites ;
- un mois sans la moindre écriture n'est pas un mois à zéro : c'est un mois qu'on n'a pas importé,
  et il ne dilue pas les moyennes.

Chaque ligne dit **d'où sort le chiffre** — nombre de mois observés, et les extrêmes. Un budget
proposé sans son écart est un chiffre qu'on accepte sans le comprendre, et qu'on ne saura pas
corriger quand il dérivera. Mesuré sur l'export réel : douze enveloppes, 3'700.36 par mois, dont
des impôts à 795.41 de médiane sur une amplitude de 229.20 à 3'285.14 — c'est justement cette
amplitude qu'il faut voir avant d'accepter.

## Filtres du journal

*Écritures* cumule une recherche texte — libellé, catégorie, **note** — et quatre filtres :
compte, mois, sens, état (sans catégorie, réparties, annotées, transferts internes). Le compte de
lignes et le solde affichés en tête suivent, sans quoi on ne saurait pas si un filtre a mordu.
Sur 783 écritures, retrouver « ce qui n'est pas classé en juillet, au débit » cesse d'être un
dépouillement : trois listes déroulantes, quinze lignes.

## Hors ligne

L'application s'ouvre **sans réseau** une fois visitée. C'était une contradiction du produit :
tout est calculé et rangé dans le navigateur, aucune requête n'est nécessaire pour lire son
budget — et pourtant l'application installée sur l'écran d'accueil ne démarrait pas dans un train.
Le journal était local, le code ne l'était pas.

- La liste des fichiers à mettre en cache est **écrite à la construction** (`vite.config.js`) :
  les noms portent une empreinte de contenu, et une liste tenue à la main serait fausse dès le
  déploiement suivant. Le cache est nommé d'après cette empreinte, si bien qu'une version nouvelle
  n'hérite jamais des fichiers de l'ancienne.
- **Rien de ce qui sort du site n'est mis en cache** — ni Supabase, ni quoi que ce soit d'autre :
  un journal comptable n'a pas à traîner dans un cache HTTP.
- Une navigation retombe sur la coquille : hors ligne, personne ne sert `/ecritures`.
- Un fichier manquant ne fait pas échouer l'installation entière, ce qui laisserait l'application
  sans cache du tout.

Vérifié en coupant le réseau : rechargement, lien profond `/patrimoine` et journal complet
répondent à l'identique. Et **la contre-épreuve** — le même parcours en empêchant le service
worker de s'installer — échoue sur `net::ERR_INTERNET_DISCONNECTED` : le contrôle sait donc
échouer, ce qui est la seule chose qui le rende utile.

La couleur de démarrage suivait encore l'ancien thème clair : l'écran de lancement et la barre
d'état sont passés au fond sombre de l'application.

## À faire : la clôture du mois

Tout ce que l'application sait signaler existait déjà — écritures à trancher, à affiner, paires à
confirmer, comptes sans solde, écarts de rapprochement, charges qui ont dérivé, enveloppes
dépassées, positions non relevées. Le problème n'était pas qu'elle se taise : **chaque signal
vivait sur son écran**, et un ménage qui ouvre l'application dix minutes par mois n'ira pas les
chercher un par un.

La carte *À faire*, en tête du tableau de bord, les rassemble et les ordonne par gravité. Elle ne
calcule rien de neuf.

- Elle **disparaît quand il n'y a rien** : c'est ce qui la rend crédible. Une liste toujours
  présente devient un décor, et un décor ne se lit pas. Un test vérifie qu'un journal propre ne
  produit aucune ligne.
- Chaque ligne mène à l'écran qui la traite, et dit **pourquoi ça compte** : « tant que les
  transferts ne sont pas confirmés, ils comptent double dans les revenus et les dépenses ».
- Une pastille de gravité, pas une ligne colorée : le rouge doit rester rare pour vouloir dire
  quelque chose.

Sur l'export réel, au premier import : 154 écritures sans catégorie, 53 transferts à confirmer,
6 comptes sans solde, 352 catégories à préciser pour 35'398.67.

## Transferts internes : deux listes, pas une

Un virement d'un de vos comptes vers un autre apparaît deux fois dans le relevé : une sortie et une
entrée. Tant qu'il n'est pas confirmé, **il gonfle les deux côtés** — mesuré sur un export réel,
9'270.00 de revenus et 9'170.00 de dépenses fantômes sur six mois. En juin, les revenus affichés
passaient de 10'317.90 à 6'217.90 une fois les paires confirmées : 40 % d'écart.

La détection est stricte par construction — montant exactement opposé, comptes différents, cinq
jours au plus, contrepartie la plus proche en date. Sur le même export, **48 des 53 paires tombent
le jour même**, réparties sur quatre couples de comptes ; cinq arrivent avec deux à cinq jours
d'écart.

Ces deux populations ne se traitent pas pareil, et l'écran ne les mélange plus :

- **Les habitudes.** Une sortie et une entrée du même montant exact, le même jour, entre deux
  comptes du ménage : c'est la définition d'un virement interne, pas une question. Elles se
  confirment par couple de comptes — quatre gestes au lieu de quarante-huit, avec le nombre, les
  mois couverts, le total et les montants sous les yeux.
- **Les décalées.** À quelques jours d'écart, un paiement et une recette du même montant peuvent
  n'avoir aucun rapport. Une paire confirmée à tort **efface les deux écritures des totaux**, et
  l'erreur est silencieuse : les soldes n'ayant pas bougé, le rapprochement bancaire reste juste et
  ne la rattrape pas. Elles se regardent une par une, et **aucun geste de masse ne les emporte** —
  c'est la propriété que le fichier de tests éprouve en premier.

Neuf décisions au lieu de cinquante-trois, sans qu'aucune devienne plus aveugle.

## Affiner ce que la banque a classé en gros

La banque ne classe qu'en racines : « Santé, sport et beauté » devient *Santé*, « Assurances »
devient *Assurances*. Or tout ce qui sert vraiment travaille en catégories **fines** — une
déclaration distingue une prime LAMal d'une assurance ménage, un budget distingue les courses des
restaurants.

Mesuré sur un export réel : **352 écritures sur 783 portent une racine**, pour 35'426 francs —
plus que les 154 sans catégorie. Ce gisement était invisible : ces écritures ne remontaient nulle
part, puisqu'elles *sont* classées.

*Plus → Révision → À affiner* les regroupe par tiers, du plus lourd au plus léger. Le sélecteur
propose d'abord les **sous-catégories de la racine** — dans neuf cas sur dix la bonne réponse est
là, et la faire chercher dans soixante-dix entrées serait le meilleur moyen de ne jamais affiner —
puis le reste du plan de comptes, parce que la banque se trompe de branche : elle range la prime
maladie sous *Assurances*, la déclaration la veut sous *Santé*.

- Seules les **racines** sont remplacées : une catégorie fine déjà posée n'est jamais touchée.
- Le choix est **retenu en règle de tiers** dans le même geste. Les règles passant avant la
  correspondance de la banque à l'import, le prochain relevé arrive déjà fin — sans quoi le
  travail serait à refaire tous les mois.
- Un même tiers réparti sur deux racines est proposé deux fois : *Migros* peut être *Alimentation*
  sur une ligne et *Shopping* sur une autre, et les deux ne se traitent pas ensemble.

### Où s'arrêter

Le travail est à **rendement décroissant**, et fortement : mesuré sur le même export, cinq tiers
valent 43 % du montant à affiner, vingt en valent 80 %, et **98 des 147 tiers ne reviennent qu'une
seule fois**, pour 6'807.53 à eux tous — 19 % du total. Une file de cent quarante-sept éléments
d'apparence égale fait abandonner avant le vingtième, c'est-à-dire avant d'avoir eu l'essentiel.

L'écran propose donc trois entrées, parce qu'on n'affine pas pour la même raison selon le jour :

| Vue | Ce qu'elle montre | Sur l'export réel |
|---|---|---|
| **Déclaration** | Les tiers dont la racine alimente un poste de la déclaration | 77 tiers · 14'248.58 · 40 % du montant |
| **Budget** | Les plus lourds, jusqu'à couvrir 80 % du montant | 20 tiers · 28'397.95 |
| **Tout** | La file entière, du plus lourd au plus léger | 147 tiers · 35'398.67 |

L'enjeu fiscal n'est pas une liste écrite à la main : il se **dérive** du plan de comptes et des
postes fiscaux. Le jour où un poste gagne une catégorie, la file le sait sans qu'on y pense, et les
deux ne peuvent pas diverger. Une pastille *déclaration* marque les lignes concernées dans toutes
les vues — sur l'export réel, 77 des 147, ce qui est bien le point : elle discrimine.

## Récapitulatif fiscal

*Plus → Impôts.* Ce que le journal contient, poste par poste, sur une année civile : primes
d'assurance maladie, frais médicaux à charge, prévoyance liée, intérêts de dettes, dons, frais de
déplacement, acomptes versés, et la fortune au 31 décembre — dettes déduites. Export `.xlsx`.

**Aucune déduction n'est calculée**, et c'est délibéré. Les plafonds, les seuils et les barèmes
dépendent du canton, de la commune, de l'état civil et du revenu net déterminant ; un montant
déductible calculé de travers ne se voit pas dans une déclaration, il se voit dans la taxation un
an plus tard. Chaque poste porte donc la règle en une phrase et le montant brut tiré des relevés.
À quelqu'un qui sait remplir une déclaration, il ne manque pas les règles : il manque les totaux.

- Une **année incomplète** est signalée. Douze mois mouvementés ne prouvent pas que tout est là,
  mais moins de douze prouvent que non — et rien, dans les chiffres, ne le dirait.
- Les postes ne se remplissent qu'avec des catégories **fines** : la banque classe en
  « Assurances », la déclaration distingue une prime LAMal d'une assurance ménage.
- Les **revenus encaissés** ne sont pas le salaire brut. Le certificat de salaire fait foi ; ce
  total sert à le recouper.
- Deux catégories ont été ajoutées pour le propriétaire : **Intérêts hypothécaires** (dépense,
  déductible) et **Amortissement hypothécaire** (épargne — il réduit la dette, donc augmente la
  fortune imposable, et n'a rien à faire dans le reste à vivre).

## Contrôle des soldes

L'import prouve qu'**à l'intérieur** d'un relevé, ouverture + mouvements = clôture. Il ne peut
rien dire de ce qui se passe **entre** deux relevés : un mois jamais importé, un export tronqué,
un fichier oublié. Le journal paraît complet, les totaux sont plausibles, et il manque pourtant
des écritures.

*Plus → Comptes → Contrôle des soldes* fait l'arithmétique qui ne pardonne pas : entre deux soldes
connus, la différence doit valoir la somme des mouvements de l'intervalle. Sinon l'écart chiffre
exactement ce qui manque.

- Un écart **négatif** : le journal montre moins de mouvements que les soldes n'en supposent — il
  manque des écritures, un relevé est à réimporter.
- Un écart **positif** : l'inverse — des écritures en trop, ou un solde saisi qui n'est pas celui
  de cette date.
- Le jour du premier solde est **exclu** de l'intervalle : il est déjà compris dedans, et le
  recompter créerait un faux écart à chaque contrôle.
- La carte ne s'affiche pas quand il n'y a rien à contrôler — il faut deux soldes par compte. Un
  contrôle impossible n'est pas un contrôle réussi.

## Notes

Une catégorie range, une **note** explique : « remboursé par Marie », « acompte, solde en mars ».
Elle s'écrit en ouvrant une écriture, elle est **cherchable** — c'est souvent pour ça qu'on l'a
écrite — et elle part dans les exports CSV et Excel. Une note vidée est retirée plutôt que rangée
comme chaîne vide : les deux se ressemblent à la lecture et se comptent différemment.

## Organisation du code

```
budget-menage/  cette application en ligne (Vercel + Supabase)
budget-app/     la version locale du même projet, dans le même dépôt : serveur Node + SQLite,
                découpage d'écriture, sauvegarde de la base — rien ne quitte la machine
```

```
src/lib/        montants, dates, lecture CSV et MT940, plan de comptes, journal, patrimoine,
                écriture de classeurs Excel — sans dépendance à React
src/store/      session Supabase, état du budget et sa synchronisation
src/pages/      Connexion, Import, Budget, Écritures, Tiers, Révision, Patrimoine, Comptes,
                Plus, Réglages
supabase/       schéma et règles d'accès, source de vérité versionnée
```

Le domaine (`src/lib/`) ne touche ni à React, ni au réseau : il rend des résultats inertes que
l'interface affiche et que le store persiste. C'est ce qui le rend testable sur des échantillons,
et c'est là que vivent les 253 tests.

## Limites connues

- **Les cours ne sont pas récupérés automatiquement**, et ne le seront pas : le cours d'un ETF
  ou du Bitcoin se saisit, une fois par mois, à côté de la quantité.
- **Pas de conversion de devise** : une écriture en EUR est conservée telle quelle et n'entre
  pas dans les totaux CHF.
- **Un montant à trois décimales sans indication** (`1.005`) est lu comme un groupe de milliers,
  un relevé bancaire portant deux décimales.
- **L'appairage des transferts** se fait sur le montant, la date et le compte : deux virements
  de même montant entre les deux mêmes comptes à quelques jours d'intervalle peuvent être
  appariés en croix. La confirmation étant manuelle, l'erreur se voit avant d'être enregistrée.
