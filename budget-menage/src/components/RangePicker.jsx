/**
 * Sélecteur de période, sous le héros.
 *
 * Les périodes plus longues que l'historique disponible sont **grisées, pas
 * masquées** : leur absence dit quelque chose — « il n'y a pas encore un an de
 * données » — et une option qui apparaît au fil des mois se remarque, là où un
 * bouton qui aurait toujours été là ne se remarquerait jamais.
 *
 * Une période plus longue que les données donnerait la même courbe que « Tout »
 * en laissant croire à une profondeur d'historique qui n'existe pas.
 */

export const RANGES = [
  { cle: '1M', mois: 1, label: '1M' },
  { cle: '3M', mois: 3, label: '3M' },
  { cle: '6M', mois: 6, label: '6M' },
  { cle: '1A', mois: 12, label: '1A' },
  { cle: 'tout', mois: null, label: 'Tout' },
];

export default function RangePicker({ valeur, onChange, moisDisponibles }) {
  return (
    <div className="ranges" role="group" aria-label="Période">
      {RANGES.map((r) => {
        // « Tout » est toujours offert ; les autres exigent d'avoir au moins la
        // profondeur qu'ils annoncent.
        const possible = r.mois === null || moisDisponibles >= r.mois;
        return (
          <button
            key={r.cle}
            type="button"
            aria-pressed={valeur === r.cle}
            disabled={!possible}
            title={possible ? undefined : `Moins de ${r.mois} mois d’historique`}
            onClick={() => onChange(r.cle)}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}

/** Nombre de mois que couvre une période, ou `null` pour « tout ». */
export function moisDe(cle) {
  return (RANGES.find((r) => r.cle === cle) || {}).mois ?? null;
}
