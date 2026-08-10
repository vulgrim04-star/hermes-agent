import { useState } from 'react';

import { AccountsPage } from './AccountsPage.js';
import { BatchesPage } from './BatchesPage.js';
import { RulesPage } from './RulesPage.js';

const TABS = [
  { key: 'comptes', label: 'Comptes & ménage' },
  { key: 'regles', label: 'Règles' },
  { key: 'lots', label: "Lots d'import" },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/** Coquille des réglages : les écrans de paramétrage rassemblés en onglets. */
export function SettingsPage() {
  const [tab, setTab] = useState<TabKey>('comptes');

  return (
    <div className="flex flex-col gap-6">
      <nav className="flex gap-1 border-b border-slate-200">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setTab(entry.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === entry.key
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {tab === 'comptes' && <AccountsPage />}
      {tab === 'regles' && <RulesPage />}
      {tab === 'lots' && <BatchesPage />}
    </div>
  );
}
