---
name: suisse
description: La référence métier suisse de l'application de budget — charge théorique hypothécaire au taux de calcul de 5 %, premier et deuxième rang, amortissement, pilier 3a, postes déductibles et non déductibles, particularités fribourgeoises. À charger avant tout calcul touchant à l'hypothèque, à la prévoyance ou à la fiscalité.
---

# Ce qui ne se réinvente pas

L'application est tenue par un spécialiste comptable, canton de Fribourg, couple
marié. Les règles ci-dessous sont celles du métier ; elles sont déjà codées, et
elles se relisent avant d'être retouchées.

## Charge théorique d'un bien immobilier

C'est le calcul que fait la banque, et il ne se fait **jamais au taux réel du
prêt**. Constantes dans `budget-menage/src/lib/patrimoine.js` :

| Constante | Valeur | Ce qu'elle veut dire |
|---|---|---|
| `TAUX_CALCUL_BP` | `500` → 5 % | Taux de calcul, indépendant du taux obtenu |
| `CHARGES_BP` | `100` → 1 % | Entretien et frais accessoires, sur la valeur du bien |
| `PREMIER_RANG_BP` | `6667` → 66,67 % | Le premier rang s'arrête aux deux tiers de la valeur |
| `AMORTISSEMENT_ANNEES` | `15` | Le deuxième rang s'amortit sur quinze ans |
| `CHARGE_MAX_BP` | `3333` → 33,33 % | La charge totale ne doit pas dépasser le tiers du revenu brut |

La charge théorique additionne donc trois choses : **intérêts au taux de calcul
de 5 %**, **entretien à 1 % de la valeur**, et **l'amortissement annuel du
deuxième rang**. Elle est tenable si elle reste sous le tiers du revenu brut du
ménage.

Le deuxième rang, c'est la part de la dette qui dépasse les deux tiers de la
valeur du bien. C'est elle, et elle seule, qui doit être amortie.

## Amortissement : direct ou indirect

**Direct** : le versement rembourse la dette. Les intérêts baissent, mais la
fortune imposable monte et les intérêts déductibles diminuent.

**Indirect par le 3a** : le versement va sur un pilier 3a nanti. La dette ne
bouge pas — donc la déduction des intérêts reste entière — et le versement est
lui-même déductible dans la limite du plafond annuel.

L'arbitrage entre les deux est une vraie question fiscale, pas un détail
d'affichage : `arbitrage3aDirect()` dans `patrimoine.js`.

## Pilier 3a

**Le plafond n'est pas une constante du code.** Il change chaque année et n'est
publié qu'en fin d'année précédente : c'est donc une **donnée saisie**, dans
`state.settings.tax` (`ledger.js`). Au moment où ces lignes sont écrites, seul
`2025: 725800` est renseigné — 7'258.00 francs — et **2026 ne l'est pas**.

Conséquence à tenir : quand le plafond de l'année manque, `pillar3aStatus()`
**refuse de calculer le reste à verser** et le dit. Ne jamais reprendre le
plafond de l'année précédente pour combler le trou, ne jamais coder un plafond
en dur. Un chiffre inventé dans une déclaration est pire qu'un chiffre absent.

## Déductible, non déductible

C'est la distinction qui structure `fiscal.js`, et elle se trompe facilement :

- **Les intérêts hypothécaires se déduisent. L'amortissement, non** — c'est du
  capital : il réduit la dette, donc il augmente la fortune imposable.
- **Les primes maladie** : la déduction est **forfaitaire et plafonnée**. Le
  montant payé n'est pas le montant déductible.
- **Les frais médicaux** ne se déduisent qu'**au-delà d'une part du revenu net**
  — 5 % au fédéral, le canton peut différer.
- **Les frais de déplacement** sont plafonnés, et seulement pour le trajet
  domicile-travail.
- **Les dons** se déduisent au-delà d'un minimum et dans une limite du revenu
  net, pour les organisations reconnues.
- **Les impôts versés ne se déduisent pas.** On les suit pour le bouclement et
  pour les comparer à la taxation reçue.

## La règle de conduite, et elle est absolue

**L'application récapitule des montants. Elle ne calcule aucune déduction.**
C'est un choix assumé, écrit en tête de `fiscal.js` : les plafonds, les seuils
et les barèmes changent chaque année et par canton, et une déduction fausse
présentée comme un fait vaut moins que rien dans une déclaration.

Si on te demande d'ajouter un calcul de déduction, dis pourquoi c'est un piège
avant de le faire — puis, si la demande est maintenue, fais-le en affichant
l'année et la source du barème, et en le rendant vérifiable.

## Fortune au 31 décembre

C'est la date que retient la déclaration. Les positions se relèvent à cette
date-là, pas à la date du jour.

## Formatage

Apostrophe droite pour les milliers, point décimal, deux décimales :
`12'450.80`. `Intl.NumberFormat('de-CH')` produit l'apostrophe typographique
U+2019, qui n'est pas la forme d'un relevé — d'où le formatage à la main dans
`money.js`.
