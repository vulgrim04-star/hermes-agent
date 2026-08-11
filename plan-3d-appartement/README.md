# Appartement 74 m² — plan 3D meublé et planches 2D

Relevé de l'appartement à partir du plan d'origine, puis restitution en
axonométrie meublée et en planches 2D à l'échelle.

| Fichier | Contenu |
| --- | --- |
| `index.html` | Page autonome : axonométrie meublée interactive (rotation, vue de dessus, cotes, export PNG) |
| `plan-2d-A3-1-50.pdf` | A3 au 1:50 — planche meublée + planche de base cotée |
| `plan-2d-A4-1-75.pdf` | A4 au 1:75 — mêmes planches |
| `plan_data.py` | Source unique : sommets, cloisons, baies, mobilier |
| `make_pdf.py` | Génère les deux PDF depuis `plan_data.py` |
| `build.py` | Injecte `plan_data.py` dans `plan3d.tpl.html` → `index.html` |

## Relevé

Le contour et chaque axe de cloison ont été suivis sur le plan d'origine :
détection des traits, régression sur les points relevés, intersection des
droites pour obtenir les sommets. Le contour fermé mesure **74,77 m²** et les
longueurs retrouvées tombent à moins d'un centimètre des cotes portées sur le
plan (6,41 / 7,20 / 6,18 / 5,47 / 2,96 / 6,30 m). Les baies sont positionnées
d'après la densité du hachuré le long de chaque façade.

Cloisons 9 cm, murs de façade 22 cm. En 3D les murs sont recoupés à 1,30 m
pour dégager la vue plongeante ; hauteur sous plafond réelle 2,55 m.

## Surfaces

Séjour-cuisine-entrée 34,8 · Chambre 13,0 · Dressing 11,3 · Salle d'eau 5,6 ·
Salle de bains 5,2 · Loggia 5,0 — **74,8 m²**.

## Reconstruire

```sh
python3 build.py       # index.html
python3 make_pdf.py    # les deux PDF
```
