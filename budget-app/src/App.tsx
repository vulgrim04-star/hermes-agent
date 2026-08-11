import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { BudgetsPage } from './pages/BudgetsPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { ImportPage } from './pages/ImportPage.js';
import { NetWorthPage } from './pages/NetWorthPage.js';
import { ReviewPage } from './pages/ReviewPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { TransactionsPage } from './pages/TransactionsPage.js';
import { initTheme } from './lib/theme.js';
import {
  IconBudget,
  IconDashboard,
  IconImport,
  IconLedger,
  IconReview,
  IconSettings,
  IconWealth,
} from './components/Icons.js';

/*
 * Cinq onglets dans la barre du bas, comme en ligne : au-delà, les cibles
 * deviennent plus étroites que le pouce qui les vise. Budgets et Réglages, plus
 * rarement ouverts, restent accessibles depuis l'en-tête sur téléphone et
 * reprennent leur place dans la barre dès qu'il y a la largeur.
 */
const PRIMARY = [
  { to: '/tableau-de-bord', label: 'Budget', Icon: IconDashboard },
  { to: '/transactions', label: 'Écritures', Icon: IconLedger },
  { to: '/revision', label: 'Révision', Icon: IconReview },
  { to: '/patrimoine', label: 'Patrimoine', Icon: IconWealth },
  { to: '/import', label: 'Import', Icon: IconImport },
];

const SECONDARY = [
  { to: '/budgets', label: 'Budgets', Icon: IconBudget },
  { to: '/reglages', label: 'Réglages', Icon: IconSettings },
];

const TITLES: Record<string, string> = {
  '/tableau-de-bord': 'Tableau de bord',
  '/transactions': 'Écritures',
  '/revision': 'Révision',
  '/budgets': 'Budgets',
  '/patrimoine': 'Patrimoine',
  '/import': 'Import',
  '/reglages': 'Réglages',
};

/** Le grand titre se replie dans la barre dès qu'on commence à lire. */
function useCollapsed(threshold = 26): boolean {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const onScroll = () => setCollapsed(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return collapsed;
}

/*
 * Un même onglet, deux formes. Sous le pouce : icône au-dessus du mot, en tout
 * petit, sur toute la largeur. À la souris : une pastille horizontale, l'actif
 * en aplat bleu.
 */
const tabClass = ({ isActive }: { isActive: boolean }) =>
  [
    'relative flex flex-col items-center justify-center gap-[3px] px-0.5 pt-[7px] pb-1.5',
    'text-[10px] tracking-tight no-underline transition',
    'sm:flex-row sm:gap-2 sm:rounded-md sm:px-3 sm:py-1.5 sm:text-sm sm:font-medium',
    isActive
      ? 'text-blue-600 sm:bg-blue-600 sm:on-accent'
      : 'text-slate-400 sm:text-slate-500 sm:hover:bg-slate-100 sm:hover:text-slate-900',
  ].join(' ');

/* Budgets et Réglages ne paraissent dans la barre qu'à partir de la largeur qui
   les autorise ; sur téléphone, ils vivent dans l'en-tête. */
const wideTabClass = ({ isActive }: { isActive: boolean }) =>
  ['hidden sm:flex', tabClass({ isActive })].join(' ');

export function App() {
  useEffect(() => {
    initTheme();
  }, []);

  const location = useLocation();
  const collapsed = useCollapsed();
  const title = TITLES[location.pathname] ?? 'Budget du ménage';

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="min-h-screen">
      <header
        className={`chrome sticky top-0 z-30 border-b transition-colors ${
          collapsed ? 'border-slate-100' : 'border-transparent'
        }`}
      >
        <div className="mx-auto flex min-h-[44px] max-w-7xl items-center gap-4 px-4 sm:px-6">
          <h1
            className={`hidden text-[17px] font-bold tracking-tight sm:block ${
              collapsed ? 'opacity-0' : ''
            }`}
          >
            Budget du ménage
          </h1>
          <span
            className={`pointer-events-none absolute left-1/2 -translate-x-1/2 text-[17px] font-semibold tracking-tight transition-opacity ${
              collapsed ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {title}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <span className="hidden text-xs text-slate-400 sm:inline">Données locales — CHF</span>
            {SECONDARY.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                aria-label={item.label}
                className="rounded-md p-2 text-blue-600 sm:hidden"
              >
                <item.Icon />
              </NavLink>
            ))}
          </div>
        </div>
      </header>

      {/* Téléphone : barre fixée en bas, sous le pouce. Écran large : la même
          liste posée horizontalement sous l'en-tête. */}
      <nav
        aria-label="Sections"
        className="tabbar fixed inset-x-0 bottom-0 z-40 grid grid-flow-col auto-cols-fr border-t border-slate-100 sm:sticky sm:top-[45px] sm:mx-auto sm:max-w-7xl sm:auto-cols-auto sm:justify-start sm:gap-1 sm:border-t-0 sm:bg-transparent sm:px-6 sm:py-1.5 sm:backdrop-blur-none"
      >
        {PRIMARY.map((item) => (
          <NavLink key={item.to} to={item.to} className={tabClass}>
            <item.Icon />
            <span>{item.label}</span>
          </NavLink>
        ))}
        {SECONDARY.map((item) => (
          <NavLink key={item.to} to={item.to} className={wideTabClass}>
            <item.Icon />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <main className="mx-auto max-w-7xl px-4 pb-28 sm:px-6 sm:pb-16">
        <h2 className="largetitle py-2 pb-3">{title}</h2>
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
