---
name: recette
description: Le protocole de vérification au navigateur de l'application de budget (budget-menage/) — script Playwright type, viewport iPhone, coupure de Supabase, mesures de débordement et d'erreurs console, contre-épreuve obligatoire, règles de confidentialité des données bancaires réelles. À charger avant toute vérification d'interface.
---

# Vérifier, pas illustrer

## La règle qui commande tout le reste

**Une vérification qui ne peut pas échouer ne prouve rien.** Pour chaque
affirmation sérieuse, on casse volontairement la condition et on constate que le
contrôle passe au rouge.

Sur ce dépôt, la preuve que le service worker rend l'application utilisable hors
ligne tient en deux essais, pas un : réseau coupé, l'application répond ; puis le
même parcours en empêchant `sw.js` de s'installer, qui tombe sur
`net::ERR_INTERNET_DISCONNECTED`. C'est le second qui donne sa valeur au premier.

De même, la mesure de débordement horizontal n'a de valeur que parce qu'elle a
déjà attrapé un vrai défaut — le `<select>` que « Shopping › Équipement du
ménage » poussait hors de l'écran.

## Les données réelles : trois interdits

L'export bancaire réel est **hors du dépôt**, sous `/root/.claude/uploads/`.
Retrouve-le par glob, ne code pas le chemin en dur.

1. **Il n'entre jamais dans le dépôt** et ne se commite jamais.
   `budget-menage/.gitignore` exclut `*.csv` sauf `fixtures/*.csv`.
2. **Aucun IBAN réel** n'apparaît dans un fichier écrit, un test ou un rapport.
3. Quand la sortie peut être partagée, **on n'imprime que des agrégats** —
   « 783 écritures, 6 comptes, solde −2'293.26 », jamais une ligne d'écriture.

La clé Supabase `service_role` ne doit jamais entrer dans le bundle client.

## Le dispositif

On sert **le bundle construit**, jamais le serveur de développement : c'est lui
qui est publié, et lui seul qui porte les noms empreintés et le service worker.

```bash
cd budget-menage && npm run build && npx vite preview --port 4177
```

```js
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({
  viewport: { width: 393, height: 852 },   // iPhone 15 : le vrai téléphone
  deviceScaleFactor: 3,
});

const erreurs = [];
ctx.on('page', (p) => {
  p.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
  p.on('pageerror', (e) => erreurs.push(String(e)));
});

// Rien ne sort : la recette porte sur le mode local.
await ctx.route('**/*.supabase.co/**', (r) => r.abort());
```

Chromium est préinstallé (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). **Ne
lance jamais `playwright install`.**

## Les cinq mesures

**1. Débordement horizontal, écran par écran.**

```js
const trop = await page.evaluate(() =>
  document.documentElement.scrollWidth > window.innerWidth
    ? [document.documentElement.scrollWidth, window.innerWidth] : null);
```

Attendu : égalité stricte, sur **chacun** des écrans — tableau de bord,
écritures, révision, tiers, budget, patrimoine, comptes, impôts, réglages — pas
sur un seul.

**2. Erreurs console : zéro**, `pageerror` compris, collectées dès l'ouverture
du contexte et pas après le premier clic.

**3. Les deux thèmes.** Le sombre est le défaut ; le clair ne vaut que sous
`[data-theme="light"]`. Vérifie la lisibilité du clair, et surtout qu'aucun
écran ne dépend d'une couleur définie sous `prefers-color-scheme` — l'état non
stampé doit être complet.

**4. Les chiffres, pas les pixels.** Relève les valeurs affichées et compare-les
d'un écran à l'autre. Un total qui change selon la page est une régression
qu'aucune capture ne montre.

**5. Hors ligne.** `ctx.setOffline(true)`, rechargement, lien profond
(`/patrimoine`), nombre d'écritures et solde identiques à l'état en ligne. Puis
la contre-épreuve.

## Les pièges de localisation, déjà rencontrés ici

- Les onglets portent des pastilles de comptage :
  `getByRole('link', { name: 'Plus' })` a matché **« Plus207 »**. Utilise une
  regex non ancrée, ou `exact: true` selon le cas.
- Certains libellés existent en onglet **et** en ligne de liste — « Budget » est
  à la fois un onglet et un lien de la carte « À faire ». Scope au bloc.
- Les lignes de liste s'ouvrent par un `button.lead` ou un `a.lead`, pas par le
  `<li>`.
- **Renommer un compte retrie la liste sous le doigt.** Ordonne les étapes en
  conséquence, ou la sélection portera sur la mauvaise ligne.

## Le compte rendu

En français, chiffré, chaque affirmation adossée à une mesure. Un échec se
rapporte avec sa sortie brute. Un point non vérifié se signale — une recette
incomplète annoncée comme complète est pire qu'une recette qui manque.
