import { LEAVES } from '../lib/categories.js';

/** Sélecteur de catégorie, arborescence aplatie « Racine › Feuille ». */
export default function CategorySelect({ value, onChange, disabled }) {
  return (
    <select value={value || ''} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">— à classer —</option>
      {LEAVES.map((c) => (
        <option key={c.name} value={c.name}>{c.parent} › {c.name}</option>
      ))}
    </select>
  );
}
