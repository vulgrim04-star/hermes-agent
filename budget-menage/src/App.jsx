import { useEffect } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';

import { configured } from './lib/supabaseClient.js';
import { isDemo, leaveDemo } from './lib/demo.js';
import { initAuth, signOut, useAuth } from './store/useAuth.js';
import { loadForUser, useBudget } from './store/useBudget.js';
import { pendingCount } from './lib/ledger.js';

import Login from './pages/Login.jsx';
import Password from './pages/Password.jsx';
import Import from './pages/Import.jsx';
import NetWorth from './pages/NetWorth.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Transactions from './pages/Transactions.jsx';
import Review from './pages/Review.jsx';
import Settings from './pages/Settings.jsx';

const TABS = [
  { to: '/', label: 'Tableau de bord', end: true },
  { to: '/ecritures', label: 'Écritures' },
  { to: '/revision', label: 'Révision', badge: true },
  { to: '/patrimoine', label: 'Patrimoine' },
  { to: '/import', label: 'Import' },
  { to: '/reglages', label: 'Réglages' },
];

const SYNC_LABEL = {
  'a-jour': 'enregistré',
  envoi: 'enregistrement…',
  echec: 'enregistrement interrompu',
};

export default function App() {
  useEffect(() => { initAuth(); }, []);

  const session = useAuth((s) => s.session);
  const ready = useAuth((s) => s.ready);

  // Le mode démonstration donne accès à l'application sans compte : les
  // écritures restent dans ce navigateur (voir lib/demo.js).
  if (isDemo()) {
    return (
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Shell demo />
      </BrowserRouter>
    );
  }

  // Une configuration absente doit se voir, pas provoquer un écran blanc.
  if (!configured) return <Misconfigured />;
  if (!ready) return <div className="auth"><p className="muted">Chargement…</p></div>;

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      {session ? <Shell /> : (
        <Routes>
          <Route path="/mot-de-passe" element={<Password />} />
          <Route path="*" element={<Login />} />
        </Routes>
      )}
    </BrowserRouter>
  );
}

function Shell({ demo = false }) {
  const data = useBudget((s) => s.data);
  const loading = useBudget((s) => s.loading);
  const sync = useBudget((s) => s.sync);
  const email = useAuth((s) => s.session?.user?.email);
  const pending = pendingCount(data);

  // En démonstration, aucune session n'est ouverte : le chargement local est
  // déclenché ici plutôt que par le changement d'état d'authentification.
  useEffect(() => { if (demo) void loadForUser(null); }, [demo]);

  return (
    <>
      <header className="top">
        <div className="wrap top-in">
          <span className="mark">Budget du ménage<em>.</em></span>
          <div className="top-right">
            {demo ? (
              <>
                <span className="pill warn">démonstration — rien n’est envoyé en ligne</span>
                <button type="button" className="btn quiet" onClick={leaveDemo}>Quitter</button>
              </>
            ) : (
              <>
                <span title="Synchronisation avec votre compte">
                  {sync === 'echec' ? <span className="pill err">{SYNC_LABEL.echec}</span> : SYNC_LABEL[sync]}
                </span>
                <span className="muted">{email}</span>
                <button type="button" className="btn quiet" onClick={() => void signOut()}>
                  Se déconnecter
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <nav className="tabs wrap">
        {TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => (isActive ? 'on' : '')}>
            {tab.label}
            {tab.badge && pending.total > 0 && <span className="count">{pending.total}</span>}
          </NavLink>
        ))}
      </nav>

      <main className="wrap">
        {loading ? (
          <p className="muted">Chargement de vos écritures…</p>
        ) : (
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/ecritures" element={<Transactions />} />
            <Route path="/revision" element={<Review />} />
            <Route path="/patrimoine" element={<NetWorth />} />
            <Route path="/import" element={<Import />} />
            <Route path="/reglages" element={<Settings />} />
            <Route path="/mot-de-passe" element={<Password />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>
    </>
  );
}

function Misconfigured() {
  return (
    <div className="auth">
      <div className="auth-card">
        <h1>Configuration incomplète</h1>
        <p className="lede">
          Les variables <code>VITE_SUPABASE_URL</code> et <code>VITE_SUPABASE_ANON_KEY</code> ne sont
          pas définies. Ajoutez-les dans les réglages du projet Vercel, puis redéployez : une
          variable <code>VITE_</code> est figée dans le bundle au moment de la construction, la
          définir sans redéployer n’a aucun effet.
        </p>
      </div>
    </div>
  );
}
