import { useEffect, useState } from 'react';
import {
  BrowserRouter,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';

import { configured } from './lib/supabaseClient.js';
import { isDemo, leaveDemo } from './lib/demo.js';
import { initTheme } from './lib/theme.js';
import { initAuth, signOut, useAuth } from './store/useAuth.js';
import { loadForUser, useBudget } from './store/useBudget.js';
import { pendingCount } from './lib/ledger.js';

import {
  IconDashboard,
  IconImport,
  IconLedger,
  IconReview,
  IconSettings,
  IconWealth,
} from './components/Icons.jsx';

import Login from './pages/Login.jsx';
import Password from './pages/Password.jsx';
import Import from './pages/Import.jsx';
import NetWorth from './pages/NetWorth.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Transactions from './pages/Transactions.jsx';
import Review from './pages/Review.jsx';
import Settings from './pages/Settings.jsx';

/*
 * Cinq onglets dans la barre du bas, et pas six : au-delà, les cibles
 * deviennent plus étroites que le pouce qui les vise. Les Réglages, qu'on
 * ouvre rarement, passent dans l'en-tête.
 */
const TABS = [
  { to: '/', label: 'Tableau de bord', short: 'Budget', end: true, Icon: IconDashboard },
  { to: '/ecritures', label: 'Écritures', short: 'Écritures', Icon: IconLedger },
  { to: '/revision', label: 'Révision', short: 'Révision', badge: true, Icon: IconReview },
  { to: '/patrimoine', label: 'Patrimoine', short: 'Patrimoine', Icon: IconWealth },
  { to: '/import', label: 'Import', short: 'Import', Icon: IconImport },
];

const SETTINGS = { to: '/reglages', label: 'Réglages', short: 'Réglages', Icon: IconSettings };

const TITLES = {
  '/': 'Tableau de bord',
  '/ecritures': 'Écritures',
  '/revision': 'Révision',
  '/patrimoine': 'Patrimoine',
  '/import': 'Import',
  '/reglages': 'Réglages',
  '/mot-de-passe': 'Mot de passe',
};

const SYNC_LABEL = {
  'a-jour': 'enregistré',
  envoi: 'enregistrement…',
  echec: 'enregistrement interrompu',
};

export default function App() {
  useEffect(() => {
    initTheme();
    initAuth();
  }, []);

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

/**
 * Le grand titre vit dans le flux : quand il sort de l'écran, la barre
 * supérieure prend le relais et affiche le même nom en petit. C'est le geste
 * d'iOS, et il rend la hauteur d'écran au contenu dès qu'on commence à lire.
 */
function useCollapsed(threshold = 26) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const onScroll = () => setCollapsed(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return collapsed;
}

function Shell({ demo = false }) {
  const data = useBudget((s) => s.data);
  const loading = useBudget((s) => s.loading);
  const sync = useBudget((s) => s.sync);
  const email = useAuth((s) => s.session?.user?.email);
  const pending = pendingCount(data);
  const location = useLocation();
  const collapsed = useCollapsed();
  const title = TITLES[location.pathname] || 'Budget du ménage';

  // En démonstration, aucune session n'est ouverte : le chargement local est
  // déclenché ici plutôt que par le changement d'état d'authentification.
  useEffect(() => { if (demo) void loadForUser(null); }, [demo]);

  // Chaque changement d'écran repart du haut : sur téléphone, arriver au
  // milieu d'une liste parce que la précédente était défilée désoriente.
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);

  return (
    <>
      <header className={collapsed ? 'top stuck' : 'top'}>
        <div className="wrap top-in">
          <span className="mark">Budget du ménage<em>.</em></span>
          <span className="top-title">{title}</span>
          <div className="top-right">
            {demo ? (
              <>
                <span className="pill warn">démonstration</span>
                <button type="button" className="btn quiet" onClick={leaveDemo}>Quitter</button>
              </>
            ) : (
              <>
                <span className="hide-sm" title="Synchronisation avec votre compte">
                  {sync === 'echec' ? <span className="pill err">{SYNC_LABEL.echec}</span> : SYNC_LABEL[sync]}
                </span>
                <span className="muted hide-sm">{email}</span>
                <button type="button" className="btn quiet hide-sm" onClick={() => void signOut()}>
                  Se déconnecter
                </button>
              </>
            )}
            <NavLink to="/reglages" className="btn quiet sm-only" aria-label="Réglages">
              <SETTINGS.Icon />
            </NavLink>
          </div>
        </div>
      </header>

      <nav className="tabs" aria-label="Sections">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => (isActive ? 'on' : '')}
          >
            <tab.Icon />
            <span>
              {tab.short}
              {tab.badge && pending.total > 0 && <span className="count">{pending.total}</span>}
            </span>
          </NavLink>
        ))}
        <NavLink to={SETTINGS.to} className={({ isActive }) => (isActive ? 'on wide-only' : 'wide-only')}>
          <SETTINGS.Icon />
          <span>{SETTINGS.short}</span>
        </NavLink>
      </nav>

      <main className="wrap">
        <h1 className="largetitle">{title}</h1>
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
          pas définies. Ajoutez-les dans les réglages du projet, puis redéployez : une variable est
          figée dans le bundle au moment de la construction, la définir sans redéployer n’a aucun
          effet.
        </p>
      </div>
    </div>
  );
}
