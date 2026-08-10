import { NavLink, Navigate, Route, Routes } from 'react-router-dom';

import { AccountsPage } from './pages/AccountsPage.js';
import { BatchesPage } from './pages/BatchesPage.js';
import { ImportPage } from './pages/ImportPage.js';
import { TransactionsPage } from './pages/TransactionsPage.js';

const NAVIGATION = [
  { to: '/transactions', label: 'Écritures' },
  { to: '/import', label: 'Import' },
  { to: '/lots', label: "Lots d'import" },
  { to: '/comptes', label: 'Comptes' },
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
          <Route path="/" element={<Navigate to="/transactions" replace />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/lots" element={<BatchesPage />} />
          <Route path="/comptes" element={<AccountsPage />} />
        </Routes>
      </main>
    </div>
  );
}
