import { useId, useRef, useState } from 'react';

/**
 * L'aire dégradée, sans axes — et le chiffre exact au bout du doigt.
 *
 * Un graphique de patrimoine n'a pas besoin de graduations : on ne lit jamais
 * une valeur sur un axe, on la lit en pointant un endroit de la courbe. Le
 * suivi tactile remplace donc l'axe, et l'écran rend la place que les
 * graduations occupaient.
 *
 * L'échelle est **serrée sur les valeurs**, pas ancrée à zéro : sur un
 * patrimoine qui varie de 3 % dans l'année, une échelle partant de zéro
 * donnerait une ligne plate. C'est le choix inverse de celui d'un graphique en
 * barres, et il est assumé — la variation chiffrée figure juste au-dessus, en
 * francs et en pourcentage, là où l'ordre de grandeur se lit sans ambiguïté.
 *
 * `onScrub` reçoit le point survolé, ou `null` au relâchement : c'est l'appelant
 * qui décide d'afficher ce point à la place de son héros.
 */
export default function AreaChart({ points, teinte = 'var(--accent)', onScrub = null, hauteur = 150 }) {
  const id = useId().replace(/:/g, '');
  const boite = useRef(null);
  const [index, setIndex] = useState(null);

  if (points.length < 2) return null;

  const W = 360;
  const H = hauteur;
  const pad = 10;
  // Le trait fait deux pixels : sans retrait latéral, la moitié du premier et
  // du dernier point serait coupée par le bord du cadre.
  const marge = 3;
  const valeurs = points.map((p) => p.value);
  const min = Math.min(...valeurs);
  const max = Math.max(...valeurs);
  const etendue = max - min || Math.max(1, Math.abs(max));

  const x = (i) => marge + (i / (points.length - 1)) * (W - marge * 2);
  const y = (v) => pad + (1 - (v - min) / etendue) * (H - pad * 2);

  const ligne = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const aire = `${ligne} L ${W - marge} ${H} L ${marge} ${H} Z`;

  function pointe(e) {
    const rect = boite.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const part = (e.clientX - rect.left) / rect.width;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(part * (points.length - 1))));
    setIndex(i);
    onScrub?.(points[i]);
  }

  function relache() {
    setIndex(null);
    onScrub?.(null);
  }

  const actif = index === null ? null : points[index];

  return (
    <div
      className="chart"
      ref={boite}
      // `setPointerCapture` garde le suivi même quand le doigt sort du cadre :
      // sans lui, un glissement un peu vertical relâcherait la courbe en plein
      // geste, ce qui donne l'impression d'un bug.
      onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); pointe(e); }}
      onPointerMove={(e) => { if (e.buttons || index !== null) pointe(e); }}
      onPointerUp={relache}
      onPointerCancel={relache}
      onPointerLeave={relache}
    >
      <svg viewBox={`0 0 ${W} ${H}`} height={H} preserveAspectRatio="none" role="img"
        aria-label={`Évolution de ${points[0].label} à ${points[points.length - 1].label}`}>
        <defs>
          <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={teinte} stopOpacity="0.34" />
            <stop offset="100%" stopColor={teinte} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={aire} fill={`url(#g${id})`} />
        {/* `vectorEffect` garde un trait d'épaisseur constante malgré
            l'étirement horizontal du viewBox. */}
        <path d={ligne} fill="none" stroke={teinte} strokeWidth="2"
          vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        {actif && (
          <g>
            <line x1={x(index)} x2={x(index)} y1="0" y2={H} stroke="var(--rule-strong)"
              strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <circle cx={x(index)} cy={y(actif.value)} r="4" fill={teinte}
              stroke="var(--surface)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </g>
        )}
      </svg>
      <div className="curseur-date">{actif ? actif.label : ''}</div>
    </div>
  );
}
