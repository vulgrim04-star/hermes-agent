import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { reconcile } from '../lib/csv.js';
import { analyseFile } from '../lib/analyse.js';
import { commitStatements } from '../lib/ledger.js';
import { fmt, parseAmount } from '../lib/money.js';
import { frDate } from '../lib/dates.js';
import { edit } from '../store/useBudget.js';

/**
 * Écran de diagnostic.
 *
 * Il montre ce qui a été compris du fichier, ce qui ne l'a pas été, et ce qui
 * empêche de valider. Un import ne se valide pas parce qu'il « a l'air bon » :
 * il se valide parce que le rapprochement est prouvé.
 */
export default function Import() {
  const [report, setReport] = useState(null);
  const [hot, setHot] = useState(false);
  const [message, setMessage] = useState('');
  const fileInput = useRef(null);
  const navigate = useNavigate();

  function read(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        setReport(analyseFile(reader.result, file.name));
      } catch (error) {
        setReport({ ok: false, filename: file.name, headers: [], missing: ['un contenu lisible (' + error.message + ')'] });
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function setBalance(index, which, value) {
    setReport((current) => {
      const next = { ...current, statements: current.statements.map((s) => ({ ...s })) };
      next.statements[index][which] = value.trim() === '' ? null : parseAmount(value);
      return next;
    });
  }

  function commit() {
    const result = edit((data) => commitStatements(data, report.statements));
    setReport(null);
    setMessage(
      `Import validé : ${result.added} écriture(s) ajoutée(s)` +
        (result.duplicates ? `, ${result.duplicates} doublon(s) écarté(s)` : '') +
        `. ${result.byRule + result.byBank} classée(s) d’office` +
        (result.pairs ? `, ${result.pairs} transfert(s) à confirmer` : '') + '.',
    );
    navigate('/');
  }

  if (!report) {
    return (
      <>
        {message && <p className="note ok" style={{ marginBottom: 20 }}>{message}</p>}
        <div className="block">
          <header>
            <div className="grow">
              <h3>Importer un relevé</h3>
              <p>
                Export <strong>CSV</strong> ou <strong>SWIFT MT940</strong> de votre e-banking. Le
                format est reconnu sur le contenu, pas sur l’extension ; rien n’est comptabilisé
                avant votre validation.
              </p>
            </div>
          </header>
          <div className="body">
            <div
              className={hot ? 'drop hot' : 'drop'}
              onDragEnter={(e) => { e.preventDefault(); setHot(true); }}
              onDragOver={(e) => { e.preventDefault(); setHot(true); }}
              onDragLeave={() => setHot(false)}
              onDrop={(e) => {
                e.preventDefault();
                setHot(false);
                const file = e.dataTransfer.files[0];
                if (file) read(file);
              }}
            >
              <strong>Déposez votre export ici</strong>
              <span className="muted">ou </span>
              <button type="button" className="btn" onClick={() => fileInput.current.click()}>
                choisissez un fichier
              </button>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,.txt,.tsv,.sta,.940,.mt940"
                hidden
                onChange={(e) => e.target.files[0] && read(e.target.files[0])}
              />
            </div>
            <p className="hint">
              Le fichier est lu par votre navigateur. Seules les écritures qui en sortent — date,
              libellé, montant, compte — rejoignent votre compte ; le fichier lui-même n’est envoyé
              nulle part.
            </p>
          </div>
        </div>
      </>
    );
  }

  if (!report.ok) {
    return (
      <div className="block">
        <header>
          <div className="grow"><h3>Format non reconnu</h3><p>{report.filename}</p></div>
          <button type="button" className="btn" onClick={() => setReport(null)}>Recommencer</button>
        </header>
        <div className="body">
          <div className="note err">
            <strong>Il manque :</strong>
            <ul>{report.missing.map((m) => <li key={m}>{m}</li>)}</ul>
          </div>
          <p className="hint">
            Colonnes trouvées : {report.headers.filter(Boolean).join(' · ') || 'aucune'}
          </p>
        </div>
      </div>
    );
  }

  const errors = report.issues.filter((i) => i.severity === 'erreur');
  const warnings = report.issues.filter((i) => i.severity === 'avertissement');
  const total = report.statements.reduce((sum, s) => sum + s.rows.length, 0);
  const checks = report.statements.map(reconcile);
  const broken = checks.filter((c) => c.status === 'ko');

  const blocking = [];
  if (errors.length) blocking.push(`${errors.length} ligne(s) n’ont pas pu être lues.`);
  if (broken.length) {
    blocking.push(`Le rapprochement ne boucle pas : écart de CHF ${fmt(broken.reduce((s, c) => s + c.gap, 0))}.`);
  }

  return (
    <>
      <div className="block">
        <header>
          <div className="grow"><h3>Rapport d’import</h3><p>{report.filename}</p></div>
          <button type="button" className="btn" onClick={() => setReport(null)}>Abandonner</button>
        </header>
        <dl className="stats">
          <Stat label="Format" value={report.format === 'mt940' ? 'SWIFT MT940' : 'CSV'} />
          <Stat label="Encodage" value={report.encoding} />
          <Stat
            label="Séparateur"
            value={report.format === 'mt940' ? '—' : report.delimiter === '\t' ? 'tabulation' : report.delimiter}
          />
          <Stat label="Lignes lues" value={String(report.read)} />
          <Stat label="Écritures" value={String(total)} />
          <Stat label="Comptes" value={String(report.statements.length)} />
          <Stat label="Lignes en erreur" value={String(errors.length)} />
        </dl>
        <div className="body">
          {blocking.length ? (
            <div className="note err">
              <strong>La validation est bloquée :</strong>
              <ul>{blocking.map((b) => <li key={b}>{b}</li>)}</ul>
            </div>
          ) : (
            <div className="note ok">Rien ne s’oppose à la validation.</div>
          )}
          <div className="row" style={{ marginTop: 14 }}>
            <button type="button" className="btn primary" onClick={commit} disabled={blocking.length > 0}>
              Valider l’import ({total} écritures)
            </button>
            {blocking.length > 0 && (
              <button type="button" className="btn danger" onClick={commit}>
                Forcer malgré l’écart
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="block">
        <header>
          <div className="grow">
            <h3>Relevés et rapprochement</h3>
            <p>
              {report.statements.length > 1
                ? `Ce fichier porte ${report.statements.length} relevés. Chacun est rapproché séparément.`
                : report.format === 'mt940'
                  ? 'Le MT940 porte ses soldes : le contrôle s’exécute sans rien saisir.'
                  : 'Saisissez les soldes lus dans l’e-banking pour que le contrôle s’exécute.'}
            </p>
          </div>
        </header>
        <div className="body flush">
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Compte</th><th>Période</th><th className="num">Écritures</th>
                  <th className="num">Ouverture</th><th className="num">Mouvements</th>
                  <th className="num">Clôture</th><th>Contrôle</th>
                </tr>
              </thead>
              <tbody>
                {report.statements.map((statement, index) => (
                  <tr key={statement.key}>
                    <td>{statement.label}</td>
                    <td className="muted">{frDate(statement.from)} → {frDate(statement.to)}</td>
                    <td className="num">{statement.rows.length}</td>
                    <td className="num">
                      <input
                        className="num-in"
                        placeholder="—"
                        defaultValue={statement.opening === null ? '' : (statement.opening / 100).toFixed(2)}
                        onBlur={(e) => setBalance(index, 'opening', e.target.value)}
                      />
                    </td>
                    <td className="num">{fmt(statement.movements)}</td>
                    <td className="num">
                      <input
                        className="num-in"
                        placeholder="—"
                        defaultValue={statement.closing === null ? '' : (statement.closing / 100).toFixed(2)}
                        onBlur={(e) => setBalance(index, 'closing', e.target.value)}
                      />
                    </td>
                    <td>
                      {checks[index].status === 'ok' ? <span className="pill ok">bouclé</span>
                        : checks[index].status === 'ko' ? <span className="pill err">écart {fmt(checks[index].gap)}</span>
                        : <span className="pill">sans solde</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {report.issues.length > 0 && (
        <div className="block">
          <header>
            <div className="grow">
              <h3>Lignes signalées</h3>
              <p>{errors.length} erreur(s), {warnings.length} avertissement(s)</p>
            </div>
          </header>
          <div className="body flush">
            <table className="tight">
              <tbody>
                {report.issues.slice(0, 60).map((issue, i) => (
                  <tr key={i}>
                    <td className="muted" style={{ width: 76 }}>ligne {issue.line}</td>
                    <td>
                      <span className={issue.severity === 'erreur' ? 'pill err' : 'pill warn'}>
                        {issue.severity === 'erreur' ? 'erreur' : 'avis'}
                      </span>{' '}
                      {issue.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {report.issues.length > 60 && (
              <p className="hint" style={{ padding: '12px 18px' }}>… et {report.issues.length - 60} autres.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
