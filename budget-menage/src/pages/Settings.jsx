import { useRef, useState } from 'react';

import BudgetEditor from '../components/BudgetEditor.jsx';
import CategorySelect from '../components/CategorySelect.jsx';
import { LEAVES, catOf, kindOf, rootOf } from '../lib/categories.js';
import { frDate } from '../lib/dates.js';
import { getTheme, setTheme } from '../lib/theme.js';
import { fmt } from '../lib/money.js';
import { applyBank, emptyState, monthsAvailable, normLabel } from '../lib/ledger.js';
import { positionsAt, ORIGIN_LABELS, QUANTITY_SCALE } from '../lib/networth.js';
import { buildXlsx, date as xdate, money as xmoney, number as xnumber, text as xtext } from '../lib/xlsx.js';
import { edit, replaceAll, useBudget } from '../store/useBudget.js';

const TREATMENTS = [
  ['categorie', 'Catégorie'],
  ['transfert-interne', 'Transfert interne'],
  ['ignorer', 'Ignorer'],
];

const THEME_LABELS = [
  ['dark', 'Sombre'],
  ['light', 'Clair'],
  ['auto', 'Téléphone'],
];

/**
 * Apparence.
 *
 * L'application est **sombre par défaut** : c'est un parti pris, pas une
 * conséquence du réglage du téléphone. « Clair » et « Téléphone » le
 * contredisent délibérément. Le choix vaut pour ce navigateur seulement : c'est
 * une préférence d'affichage, elle n'a rien à faire dans un journal comptable
 * partagé entre appareils.
 */
function ThemeCard() {
  const [theme, choose] = useState(getTheme);

  return (
    <div className="block">
      <header>
        <div className="grow">
          <h3>Apparence</h3>
          <p>Retenu dans ce navigateur, jamais synchronisé avec votre compte.</p>
        </div>
      </header>
      <div className="body">
        <div className="segmented" role="group" aria-label="Thème">
          {THEME_LABELS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={theme === value}
              onClick={() => choose(setTheme(value))}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Settings() {
  const data = useBudget((s) => s.data);
  const [message, setMessage] = useState('');
  const fileInput = useRef(null);

  const counts = new Map();
  for (const tx of data.tx) {
    if (!tx.ext) continue;
    const key = normLabel(tx.ext);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  // Un libellé rencontré que la table ne connaît pas encore doit se voir,
  // sans quoi il reste un angle mort de la catégorisation.
  const keys = new Set(Object.keys(data.bank));
  const unknown = [...counts.keys()].filter((k) => !keys.has(k));

  return (
    <>
      {message && <p className="note ok" style={{ marginBottom: 20 }}>{message}</p>}

      <ThemeCard />

      <BudgetEditor periods={monthsAvailable(data)} />

      <div className="block">
        <header>
          <div className="grow">
            <h3>Export et sauvegarde</h3>
            <p>
              Vos écritures vivent dans votre compte. Une sauvegarde en est une copie que vous
              gardez, indépendante du service.
            </p>
          </div>
        </header>
        <div className="body">
          <div className="row">
            <button type="button" className="btn primary" onClick={() => downloadJson(data, setMessage)}>
              Télécharger la sauvegarde (.json)
            </button>
            <button type="button" className="btn" onClick={() => downloadXlsx(data, setMessage)}>
              Exporter les écritures (.xlsx)
            </button>
            <button type="button" className="btn" onClick={() => downloadCsv(data, setMessage)}>
              Exporter les écritures (.csv)
            </button>
            <button type="button" className="btn" onClick={() => downloadPositions(data, setMessage)}>
              État des positions au 31.12 (.xlsx)
            </button>
            <button type="button" className="btn" onClick={() => fileInput.current.click()}>
              Recharger une sauvegarde…
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".json"
              hidden
              onChange={(e) => e.target.files[0] && restore(e.target.files[0], setMessage)}
            />
          </div>
          <p className="hint">
            Le classeur Excel porte des <strong>dates et des montants typés</strong> : ils se trient
            et s’additionnent sans retoucher une colonne. Le CSV sort en UTF-8 avec BOM et séparateur
            point-virgule — Excel l’ouvre sans assistant d’import et sans casser les accents.
            L’état des positions au 31 décembre de l’année close est la pièce à joindre à la
            déclaration de fortune : une ligne par position, avec l’origine de chaque chiffre.
          </p>
        </div>
      </div>

      <div className="block">
        <header>
          <div className="grow">
            <h3>Règles de catégorisation</h3>
            <p>
              Un motif contenu dans le libellé pose une catégorie. Les règles s’appliquent avant la
              correspondance de la banque : ce que vous avez écrit prime sur ce qu’elle propose.
            </p>
          </div>
        </header>
        {data.rules.length ? (
          <div className="body flush">
            <table>
              <thead><tr><th>Motif</th><th>Catégorie</th><th /></tr></thead>
              <tbody>
                {data.rules.map((rule, index) => (
                  <tr key={index}>
                    <td className="mono">{rule.pattern}</td>
                    <td>{rule.cat}</td>
                    <td className="num">
                      <button
                        type="button"
                        className="btn quiet"
                        onClick={() => edit((s) => { s.rules.splice(index, 1); })}
                      >
                        Supprimer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">Aucune règle. Créez-en depuis la file de révision.</div>
        )}
      </div>

      <div className="block">
        <header>
          <div className="grow">
            <h3>Catégories de la banque</h3>
            <p>
              La banque classe déjà chaque écriture. Les libellés évidents sont rapprochés ; les
              ambigus sont laissés vides, parce qu’une écriture sans catégorie remonte en révision
              alors qu’une écriture mal classée n’y remonte jamais.
            </p>
          </div>
        </header>
        <div className="body flush">
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Libellé de la banque</th><th className="num">Écritures</th>
                  <th>Traitement</th><th>Catégorie du ménage</th>
                </tr>
              </thead>
              <tbody>
                {[...keys, ...unknown]
                  .sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0))
                  .map((key) => {
                    const mapping = data.bank[key] || { label: key, cat: null, treat: 'categorie' };
                    return (
                      <tr key={key}>
                        <td>
                          {mapping.label}
                          {!keys.has(key) && <span className="pill warn" style={{ marginLeft: 6 }}>nouveau</span>}
                        </td>
                        <td className="num muted">{counts.get(key) || 0}</td>
                        <td>
                          <select
                            value={mapping.treat}
                            onChange={(e) => edit((s) => {
                              s.bank[key] = { ...mapping, treat: e.target.value };
                            })}
                          >
                            {TREATMENTS.map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <CategorySelect
                            value={mapping.cat}
                            disabled={mapping.treat !== 'categorie'}
                            onChange={(c) => edit((s) => { s.bank[key] = { ...mapping, cat: c }; })}
                          />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '12px 18px', borderTop: '1px solid var(--rule)' }}>
            <button
              type="button"
              className="btn"
              onClick={() => {
                const n = edit((s) => applyBank(s, s.tx.filter((t) => !t.cat)));
                setMessage(`${n} écriture(s) classée(s).`);
              }}
            >
              Appliquer aux écritures sans catégorie
            </button>
          </div>
        </div>
      </div>

      <div className="block">
        <header>
          <div className="grow">
            <h3>Effacer</h3>
            <p>Retire toutes vos écritures. Sans retour — téléchargez d’abord une sauvegarde.</p>
          </div>
        </header>
        <div className="body">
          <button
            type="button"
            className="btn danger"
            onClick={async () => {
              if (!window.confirm('Effacer toutes vos écritures ? Cette action est sans retour.')) return;
              await replaceAll(emptyState());
              setMessage('Tout a été effacé.');
            }}
          >
            Tout effacer
          </button>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------- fichiers */

function download(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadJson(data, notify) {
  const stamp = new Date().toISOString().slice(0, 10);
  download(`budget-${stamp}.json`, JSON.stringify(data), 'application/json');
  notify('Sauvegarde téléchargée.');
}

function downloadCsv(data, notify) {
  const headers = ['Date de valeur', 'Compte', 'Libellé', 'Contrepartie', 'Catégorie',
    'Sous-catégorie', 'Type', 'Montant', 'Devise', 'Catégorie banque', 'Transfert interne'];
  const quote = (v) =>
    v == null ? '' : /[";\r\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  const kinds = { revenu: 'Revenu', depense: 'Dépense', epargne: 'Épargne' };

  const lines = [headers.join(';')];
  for (const tx of data.tx) {
    const leaf = catOf(tx.cat);
    lines.push([
      frDate(tx.date),
      (data.accounts[tx.acc] || {}).label || tx.acc,
      tx.label,
      tx.cp || '',
      rootOf(tx.cat) || '',
      leaf && leaf.parent ? leaf.name : '',
      kinds[kindOf(tx.cat, tx.cents)] || '',
      (tx.cents / 100).toFixed(2),
      'CHF',
      tx.ext || '',
      tx.transfer ? 'oui' : 'non',
    ].map(quote).join(';'));
  }

  // BOM : sans lui Excel lit le fichier en ANSI et les accents sautent.
  const stamp = new Date().toISOString().slice(0, 10);
  download(`ecritures-${stamp}.csv`, '﻿' + lines.join('\r\n') + '\r\n', 'text/csv;charset=utf-8');
  notify('Export téléchargé.');
}

/** Colonnes communes aux deux exports d'écritures. */
function exportRows(data) {
  const kinds = { revenu: 'Revenu', depense: 'Dépense', epargne: 'Épargne' };
  return data.tx.map((tx) => {
    const leaf = catOf(tx.cat);
    return [
      xdate(tx.date),
      xtext((data.accounts[tx.acc] || {}).label || tx.acc),
      xtext(tx.label),
      xtext(tx.cp),
      xtext(rootOf(tx.cat)),
      xtext(leaf && leaf.parent ? leaf.name : null),
      xtext(kinds[kindOf(tx.cat, tx.cents)]),
      xmoney(tx.cents),
      xtext('CHF'),
      xtext(tx.ext),
      xtext(tx.transfer ? 'oui' : 'non'),
    ];
  });
}

const EXPORT_COLUMNS = [
  { header: 'Date de valeur', width: 14 },
  { header: 'Compte', width: 26 },
  { header: 'Libellé', width: 44 },
  { header: 'Contrepartie', width: 22 },
  { header: 'Catégorie', width: 20 },
  { header: 'Sous-catégorie', width: 22 },
  { header: 'Type', width: 12 },
  { header: 'Montant', width: 14 },
  { header: 'Devise', width: 9 },
  { header: 'Catégorie banque', width: 24 },
  { header: 'Transfert interne', width: 16 },
];

function downloadXlsx(data, notify) {
  const stamp = new Date().toISOString().slice(0, 10);
  download(`ecritures-${stamp}.xlsx`, buildXlsx({
    sheetName: 'Écritures',
    columns: EXPORT_COLUMNS,
    rows: exportRows(data),
  }));
  notify('Classeur téléchargé.');
}

/**
 * État des positions au 31 décembre de l'année close — la date que retient la
 * déclaration de fortune. Une dette en sort négative, pour que la colonne
 * s'additionne en fortune nette.
 */
function downloadPositions(data, notify) {
  const year = new Date().getUTCFullYear() - 1;
  const period = `${year}-12`;
  const positions = positionsAt(data, period);
  if (!positions.length) { notify('Aucune position à exporter : ajoutez-en dans Patrimoine.'); return; }

  download(`positions-${period}.xlsx`, buildXlsx({
    sheetName: `Positions ${period}`,
    columns: [
      { header: 'Position', width: 32 },
      { header: 'Nature', width: 16 },
      { header: 'Quantité', width: 18 },
      { header: 'Cours', width: 14 },
      { header: 'Valeur', width: 16 },
      { header: 'Origine', width: 20 },
    ],
    rows: positions.map((p) => [
      xtext(p.label),
      xtext(p.kind),
      p.quantityE8 == null ? null : xnumber(p.quantityE8 / QUANTITY_SCALE, 8),
      xmoney(p.unitPriceCents),
      p.valueCents == null ? null : xmoney(p.isLiability ? -Math.abs(p.valueCents) : p.valueCents),
      xtext(ORIGIN_LABELS[p.origin]),
    ]),
  }));
  notify(`État au 31.12.${year} téléchargé.`);
}

function restore(file, notify) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.tx)) throw new Error('ce fichier n’est pas une sauvegarde');
      await replaceAll({ ...emptyState(), ...parsed });
      notify(`Sauvegarde rechargée : ${parsed.tx.length} écriture(s).`);
    } catch (error) {
      notify('Rechargement impossible : ' + error.message + '.');
    }
  };
  reader.readAsText(file);
}
