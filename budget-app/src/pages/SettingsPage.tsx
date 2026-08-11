import { useState } from 'react';

import { Card } from '../components/ui.js';
import { THEME_LABELS, getTheme, setTheme } from '../lib/theme.js';
import { AccountsPage } from './AccountsPage.js';
import { BankCategoriesPage } from './BankCategoriesPage.js';
import { BatchesPage } from './BatchesPage.js';
import { ExportPage } from './ExportPage.js';
import { RulesPage } from './RulesPage.js';

const TABS = [
  { key: 'comptes', label: 'Comptes & ménage' },
  { key: 'regles', label: 'Règles' },
  { key: 'banque', label: 'Catégories de la banque' },
  { key: 'lots', label: "Lots d'import" },
  { key: 'export', label: 'Export & sauvegarde' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/** Coquille des réglages : les écrans de paramétrage rassemblés en onglets. */
/**
 * Apparence. « Automatique » suit le système ; les deux autres le contredisent
 * délibérément. Le choix vaut pour cette machine, pas pour la base.
 */
function ThemeCard() {
  const [theme, choose] = useState(getTheme);

  return (
    <Card
      title="Apparence"
      description="Retenu sur cette machine, jamais enregistré dans la base."
    >
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
    </Card>
  );
}

export function SettingsPage() {
  const [tab, setTab] = useState<TabKey>('comptes');

  return (
    <div className="flex flex-col gap-6">
      <ThemeCard />

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
      {tab === 'banque' && <BankCategoriesPage />}
      {tab === 'lots' && <BatchesPage />}
      {tab === 'export' && <ExportPage />}
    </div>
  );
}
