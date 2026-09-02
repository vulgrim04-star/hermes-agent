# Cat's Eyes Studio — site vitrine

Site vitrine one-page pour le salon de beauté du regard **Cat's Eyes Studio**
(extensions de cils, rehaussement & teinture, sourcils).

HTML / CSS / JS statiques, **aucune dépendance ni étape de build**.

## Structure

```
sites/cats-eyes/
├── index.html              # toute la page (contenu + données structurées SEO)
└── assets/
    ├── css/styles.css      # DA complète, pilotée par variables CSS
    ├── js/main.js          # menu, apparitions au scroll, chargement des photos
    └── img/                # ← déposer les photos ici
```

## Voir le site en local

Ouvrir `index.html` dans un navigateur, ou lancer un petit serveur :

```bash
cd sites/cats-eyes && python3 -m http.server 8000
# → http://localhost:8000
```

## Ajouter les photos

Le site fonctionne **sans photo** : chaque bloc image affiche un dégradé nude
en attendant. Il suffit de déposer les fichiers ci-dessous dans `assets/img/`
pour qu'ils remplacent automatiquement les dégradés (aucun code à modifier).

| Fichier | Emplacement | Format conseillé |
|---|---|---|
| `hero.jpg` | grande image d'accueil | paysage, 2000 px de large |
| `studio-1.jpg` | ambiance du studio | portrait 3:4 |
| `studio-2.jpg` | détail d'une pose | carré 1:1 |
| `presta-cils.jpg` | carte « Extensions de cils » | paysage 4:3 |
| `presta-rehaussement.jpg` | carte « Rehaussement » | paysage 4:3 |
| `presta-sourcils.jpg` | carte « Sourcils » | paysage 4:3 |
| `galerie-1.jpg` … `galerie-7.jpg` | galerie (7 vignettes) | carré 1:1, sauf `galerie-2` et `galerie-5` en portrait 1:2 |
| `plan.jpg` | visuel de la carte / devanture | paysage 4:3 |

> Compressez les photos (TinyPNG, Squoosh…) avant de les déposer : viser
> moins de 300 Ko par image pour garder un site rapide.

## Le logo

Les fichiers du logo sont déjà dans `assets/img/` — inutile de les fournir.
Ils sont dérivés de l'icône fournie par le salon (or sur carré crème), dont
le fond a été retiré par incrustation sur la saturation : le crème et les
ombres grises ont une saturation quasi nulle, l'or non. Les bords ont ensuite
été décontaminés (retrait de la couleur de fond dans les pixels
d'anticrénelage) pour qu'aucun halo clair n'apparaisse sur fond sombre.

| Fichier | Usage |
|---|---|
| `logo-cats-eyes.png` | verrouillage complet (yeux + nom) — pied de page |
| `logo-wordmark.png` | nom seul — en-tête, où les yeux seraient illisibles |
| `logo-mark.png` | yeux seuls — bloc « prendre rendez-vous » |
| `favicon-32/180/512.png` | onglet du navigateur, icône d'écran d'accueil |
| `og-cover.jpg` | aperçu lors d'un partage (généré, 1200 × 630) |

Tous sont sur fond transparent (sauf le favicon et l'aperçu de partage, sur
crème) et fonctionnent donc aussi bien sur le crème que sur le fond sombre.
L'or du logo est repris dans le CSS par la variable `--gold: #E4C03F`,
échantillonnée sur le fichier d'origine.

## Personnaliser la direction artistique

Toutes les couleurs et les typographies sont regroupées en haut de
`assets/css/styles.css`, dans le bloc `:root` :

```css
--cream:  #FBF8F4;  /* fond principal   */
--sand:   #F3ECE3;  /* sections claires */
--nude:   #D9C3A9;  /* accent chaud     */
--taupe:  #A8907A;  /* accent secondaire*/
--ink:    #2E2A26;  /* texte / fond sombre */
```

Changer une valeur ici met à jour tout le site. Les polices (Cormorant
Garamond + Jost) se remplacent dans le `<link>` Google Fonts de `index.html`
et dans les variables `--serif` / `--sans`.

## À compléter avant la mise en ligne

Les emplacements sont marqués par un commentaire `TODO` dans `index.html` :

- [ ] adresse postale exacte (section « Infos & accès » **et** bloc JSON-LD en bas de page)
- [ ] numéro de téléphone (lien `tel:` du bouton « Appeler le studio »)
- [ ] lien de réservation en ligne si le salon en utilise un (Planity, Treatwell, Fresha)
- [ ] horaires réels (valeurs actuelles : mar–ven 9 h 30–19 h, sam 9 h 30–17 h)
- [ ] tarifs réels (les montants affichés sont des ordres de grandeur)
- [ ] avis clientes authentiques (les trois témoignages sont des exemples)
- [ ] mentions légales / politique de confidentialité si un formulaire est ajouté

## Mise en ligne

Le site étant statique, il s'héberge gratuitement partout :

- **Netlify / Vercel** : glisser-déposer le dossier `sites/cats-eyes/`, ou
  connecter le dépôt en indiquant ce dossier comme racine de publication.
- **GitHub Pages** : publier le dossier depuis les réglages du dépôt.
- **Hébergeur classique** : envoyer le contenu du dossier par FTP.
