import { useRef, useState } from 'react';

import CategorySelect from '../components/CategorySelect.jsx';
import { LEAVES, catOf, kindOf, rootOf } from '../lib/categories.js';
import { frDate } from '../lib/dates.js';
import { fmt } from '../lib/money.js';
import { applyBank, emptyState, normLabel } from '../lib/ledger.js';
import { edit, replaceAll, useBudget } from '../store/useBudget.js';

const TREATMENTS = [
  ['categorie', 'Catégorie'],
  ['transfert-interne', 'Transfert interne'],
  ['ignorer', 'Ignorer'],
];

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
            <button type="button" className="btn" onClick={() => downloadCsv(data, setMessage)}>
              Exporter les écritures (.csv)
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
            Le CSV sort en UTF-8 avec BOM et séparateur point-virgule : Excel l’ouvre sans assistant
            d’import et sans casser les accents. Une écriture s’y retrouve avec sa catégorie, son
            compte et le libellé d’origine de la banque.
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

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
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
