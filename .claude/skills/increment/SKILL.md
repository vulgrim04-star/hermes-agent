---
name: increment
description: La boucle de travail de l'application de budget (budget-menage/) — mesurer sur les données réelles, construire, tester, vérifier au navigateur, commiter et pousser. À invoquer au début de tout incrément de développement sur cette application, ou quand on demande de « continuer le développement ».
---

# Un incrément, du début à la fin

Cette boucle n'est pas une formalité : chacune de ses étapes existe parce que
son absence a déjà coûté quelque chose sur ce projet.

## 1. Mesurer avant de décider

**On ne choisit pas quoi construire à l'intuition.** On mesure sur l'export
bancaire réel, et le chiffre décide.

C'est cette étape qui a évité de construire un stockage IndexedDB : la mesure a
donné 230 Ko d'état pour 783 écritures, soit environ quinze ans avant d'atteindre
le quota de 5 Mo de `localStorage`. Et c'est elle qui a fait naître l'écran
d'affinage : 352 écritures sur 783 — 45 %, 35 426 francs — portaient une
catégorie racine, plus que les 154 sans catégorie du tout.

L'export réel est **hors du dépôt**, sous `/root/.claude/uploads/`. Il ne s'y
copie jamais. Quand la sortie peut être partagée, on n'imprime que des agrégats.

## 2. Construire une chose, entière

Un incrément fait une chose et la finit — domaine, tests, écran, documentation.
Pas trois chantiers à moitié.

Le domaine d'abord, dans `src/lib/`, en fonctions pures avec leurs tests ; les
écrans ensuite, qui ne calculent rien. Pour tout ce qui touche aux montants, au
rapprochement ou aux règles suisses, passe par l'agent `domaine-comptable`, et
charge la skill `suisse` avant de calculer.

## 3. Les tests

```bash
cd budget-menage && npm test && npm run build
```

Les deux, systématiquement. Une construction qui casse ne se voit pas dans les
tests, et l'inverse est vrai aussi.

## 4. La recette au navigateur

Charge la skill `recette`, ou délègue à l'agent `recette-navigateur`. Le point
non négociable : **une vérification qui ne peut pas échouer ne prouve rien** —
il faut la contre-épreuve.

## 5. La revue

Avant de commiter, l'agent `revue-critique` relit le diff. Il cherche ce que les
tests ne voient pas : collisions CSS, écrans qui mentent, états vides traités
comme des fautes, échecs silencieux.

## 6. Commiter et pousser, dans la foulée

**En une seule chaîne shell, sans attendre.** L'environnement de ce dépôt a déjà
ramené l'arbre de travail à un commit antérieur en cours de session, à plusieurs
reprises, emportant des fichiers suivis. Un travail fini mais non poussé est un
travail qu'on peut perdre.

```bash
cd budget-menage && npm test && cd .. \
  && git add -A && git commit -m "…" \
  && git push -u origin claude/swiss-household-budget-app-5frk7c
```

La branche est toujours `claude/swiss-household-budget-app-5frk7c`. **Pas de
pull request** sans demande explicite.

Si l'arbre a été ramené en arrière : `git fetch` puis
`git reset --hard origin/claude/swiss-household-budget-app-5frk7c`, et rejoue les
modifications en cours. Les fichiers non suivis survivent au retour en arrière —
vérifie-les avant de conclure qu'un travail est perdu.

## 7. Rendre compte

En français, avec les chiffres mesurés. Ce qui a été construit, ce qui a été
vérifié et comment, ce qui reste. Si une partie n'a pas été faite, le dire —
c'est à l'utilisateur de décider de réduire la portée, pas à toi.

## Ce qu'on ne construit pas, et pourquoi

- **Récupération automatique des cours** — contredirait « tout reste local ».
  Les cours se saisissent une fois par mois.
- **Synchronisation bancaire** — hors périmètre.
- **Comparatif année sur année** — sans objet avant environ dix-huit mois
  d'historique, donc pas avant 2027.
- **Catégorisation par apprentissage statistique** — sur ce volume, des règles
  explicites et relisibles battent un modèle opaque.
