import { NavLink, Navigate, Route, Routes } from 'react-router-dom';

import { BudgetsPage } from './pages/BudgetsPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { ImportPage } from './pages/ImportPage.js';
import { NetWorthPage } from './pages/NetWorthPage.js';
import { ReviewPage } from './pages/ReviewPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { TransactionsPage } from './pages/TransactionsPage.js';

const NAVIGATION = [
  { to: '/tableau-de-bord', label: 'Tableau de bord' },
  { to: '/transactions', label: 'Écritures' },
  { to: '/revision', label: 'Révision' },
  { to: '/budgets', label: 'Budgets' },
  { to: '/patrimoine', label: 'Patrimoine' },
  { to: '/import', label: 'Import' },
  { to: '/reglages', label: 'Réglages' },
];

export function App() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-6 px-6 py-4">
          <h1 className="text-lg font-semibold tracking-tight">Budget du ménage</h1>
          <nav className="flex gap-1">
            {NAVIGATION.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <span className="ml-auto text-xs text-slate-400">Données locales — CHF</span>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <Routes>
          <Route path="/" element={<Navigate to="/tableau-de-bord" replace />} />
          <Route path="/tableau-de-bord" element={<DashboardPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/revision" element={<ReviewPage />} />
          <Route path="/budgets" element={<BudgetsPage />} />
          <Route path="/patrimoine" element={<NetWorthPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/reglages" element={<SettingsPage />} />
          {/* Anciennes adresses, conservées pour les signets. */}
          <Route path="/lots" element={<Navigate to="/reglages" replace />} />
          <Route path="/comptes" element={<Navigate to="/reglages" replace />} />
        </Routes>
      </main>
    </div>
  );
}
