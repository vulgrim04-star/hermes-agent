import { foldSlices } from './Donut.jsx';
import { fmt } from '../lib/money.js';

/**
 * La répartition en une barre, et la liste juste en dessous.
 *
 * Une barre segmentée tient dans douze pixels de haut là où un anneau en
 * demande cent quatre-vingts, et sur téléphone cette hauteur-là vaut cher.
 * Elle a un second avantage : un petit poste y reste un segment visible,
 * alors qu'il se réduit à un fil dans un anneau.
 *
 * Le repli au-delà de six parts, les teintes et leur ordre viennent de
 * `foldSlices` : la même palette sert l'anneau et la barre, pour qu'un poste
 * garde sa couleur d'un écran à l'autre.
 */
export default function Segments({ entries, total = null, vide = 'Rien à répartir.' }) {
  const parts = Array.isArray(entries) && entries.length && entries[0].share !== undefined
    ? entries
    : foldSlices(entries || []);

  if (!parts.length) return <p className="muted">{vide}</p>;
  const somme = total ?? parts.reduce((s, p) => s + p.value, 0);

  return (
    <>
      <div className="seg" role="img"
        aria-label={parts.map((p) => `${p.name} ${Math.round(p.share * 100)} %`).join(', ')}>
        {parts.map((p) => (
          <i key={p.name} style={{ width: `${p.share * 100}%`, background: p.color }} />
        ))}
      </div>

      <ul className="seg-legende">
        {parts.map((p) => (
          <li key={p.name}>
            <span className="puce" style={{ background: p.color }} />
            <span className="nom">{p.name}</span>
            <b>{fmt(p.value)}</b>
            <span className="part">{(p.share * 100).toFixed(1).replace(/\.0$/, '')} %</span>
          </li>
        ))}
      </ul>

      {somme > 0 && (
        <p className="hint" style={{ textAlign: 'right' }}>Total {fmt(somme)}</p>
      )}
    </>
  );
}
