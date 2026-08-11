# Budget du ménage

Application de gestion du budget d'un ménage suisse (CHF, canton de Fribourg), en ligne, avec
compte personnel. Elle importe un relevé bancaire **CSV ou SWIFT MT940**, le dédoublonne, prouve
le rapprochement avant de comptabiliser quoi que ce soit, catégorise les écritures, rend le mois
et l'année, et suit le patrimoine jusqu'à l'état au 31 décembre.

Même pile que Cat's Eyes Studio : **Vite + React** servi par **Vercel**, **Supabase** pour
l'authentification et les données. Le déploiement se fait tout seul à chaque `git push`.

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
npm test                    # 64 tests
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
src/pages/      Connexion, Import, Tableau de bord, Écritures, Révision, Patrimoine, Réglages
supabase/       schéma et règles d'accès, source de vérité versionnée
```

Le domaine (`src/lib/`) ne touche ni à React, ni au réseau : il rend des résultats inertes que
l'interface affiche et que le store persiste. C'est ce qui le rend testable sur des échantillons,
et c'est là que vivent les 64 tests.

## Limites connues

- **Les cours ne sont pas récupérés automatiquement**, et ne le seront pas : le cours d'un ETF
  ou du Bitcoin se saisit, une fois par mois, à côté de la quantité.
- **Pas de découpage d'écriture** ici : une écriture porte une seule catégorie. La version
  locale permet de la ventiler entre plusieurs.
- **Pas de conversion de devise** : une écriture en EUR est conservée telle quelle et n'entre
  pas dans les totaux CHF.
- **Un montant à trois décimales sans indication** (`1.005`) est lu comme un groupe de milliers,
  un relevé bancaire portant deux décimales.
- **L'appairage des transferts** se fait sur le montant, la date et le compte : deux virements
  de même montant entre les deux mêmes comptes à quelques jours d'intervalle peuvent être
  appariés en croix. La confirmation étant manuelle, l'erreur se voit avant d'être enregistrée.
