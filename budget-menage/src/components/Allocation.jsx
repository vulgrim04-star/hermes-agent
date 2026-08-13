import { useState } from 'react';

import Segments from './Segments.jsx';
import { allocation, setCible } from '../lib/patrimoine.js';
import { fmt, fmtRate, parseRate } from '../lib/money.js';
import { edit } from '../store/useBudget.js';

const pct = (part) => (part === null ? '—' : `${(part * 100).toFixed(1).replace(/\.0$/, '')} %`);

/**
 * Répartition des actifs par classe, et écart à la cible.
 *
 * Les dettes sont tenues hors de l'anneau : une allocation se raisonne sur ce
 * qu'on possède. Les cibles sont facultatives — sans elles la carte se contente
 * de décrire, et c'est déjà utile. Avec elles, elle dit **de combien on a
 * dérivé**, en francs : « rééquilibrer, c'est 4'200 de titres à acheter » se
 * décide, « vous êtes à 58 % au lieu de 65 % » se contemple.
 */
export default function Allocation({ data, period }) {
  const a = allocation(data, period);
  if (!a.lignes.length) return null;

  const derives = a.lignes.filter((l) => l.ecartCents !== null);

  return (
    <div className="block">
      <header>
        <div className="grow">
          <h3>Allocation par classe d’actifs</h3>
          <p>
            {fmt(a.total)} d’actifs répartis sur {a.lignes.filter((l) => l.valeur > 0).length} classe(s).
            Les dettes ({fmt(a.dettes)}) sont tenues à part : une allocation se raisonne sur ce
            qu’on possède.
          </p>
        </div>
      </header>

      <div className="body">
        <Segments
          entries={a.lignes.map((l) => ({ name: l.label, value: l.valeur }))}
          vide="Aucune position valorisée."
        />
      </div>

      <div className="body flush">
        <div className="scroll">
          <table>
            {/* Trois colonnes : la valeur et la part sont déjà dans la
                légende de la barre juste au-dessus, et les répéter poussait
                l'écart — le seul chiffre actionnable — hors de l'écran. */}
            <thead>
              <tr>
                <th>Classe</th>
                <th className="num">Cible</th>
                <th className="num">Écart</th>
              </tr>
            </thead>
            <tbody>
              {a.lignes.map((l) => <LigneClasse key={l.kind} ligne={l} />)}
            </tbody>
          </table>
        </div>
      </div>

      <div className="body">
        {derives.length === 0 ? (
          <p className="hint">
            Aucune cible fixée. En poser une par classe fait apparaître l’écart en francs — le
            montant qu’il faudrait déplacer pour revenir à l’allocation voulue.
          </p>
        ) : !a.ciblesCompletes ? (
          <p className="hint">
            Les cibles posées totalisent {fmtRate(a.cibleTotalBp)} et non 100 % : chaque écart reste
            juste classe par classe, mais leur somme ne veut rien dire.
          </p>
        ) : (
          <p className="hint">
            Un écart positif est un excédent à alléger, un écart négatif un manque à combler.
          </p>
        )}
        {a.inconnues > 0 && (
          <p className="hint">
            {a.inconnues} position(s) sans valeur ne sont dans aucun total : elles ne valent pas
            zéro, elles ne sont pas renseignées.
          </p>
        )}
      </div>
    </div>
  );
}

function LigneClasse({ ligne }) {
  const [saisie, setSaisie] = useState(ligne.cibleBp === null ? '' : (ligne.cibleBp / 100).toString());

  function poser(texte) {
    setSaisie(texte);
    // Vider le champ retire la cible : c'est le geste attendu, et il évite un
    // second bouton dont la seule fonction serait d'annuler.
    if (!texte.trim()) { edit((s) => setCible(s, ligne.kind, null)); return; }
    const bp = parseRate(texte);
    if (bp !== null) edit((s) => setCible(s, ligne.kind, bp));
  }

  return (
    <tr>
      <td>
        {ligne.label}
        <span className="muted" style={{ display: 'block', fontSize: 12 }}>
          {fmt(ligne.valeur)} · {pct(ligne.part)}
        </span>
      </td>
      <td className="num">
        <input className="num-in" style={{ width: 74 }} inputMode="decimal" placeholder="—"
          value={saisie} onChange={(e) => poser(e.target.value)} />
      </td>
      <td className={ligne.ecartCents === null ? 'num muted' : ligne.ecartCents < 0 ? 'num neg' : 'num'}>
        {ligne.ecartCents === null ? '—' : `${ligne.ecartCents > 0 ? '+' : ''}${fmt(ligne.ecartCents)}`}
      </td>
    </tr>
  );
}
