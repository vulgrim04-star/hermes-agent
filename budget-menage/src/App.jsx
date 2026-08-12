import { useEffect, useState } from 'react';
import {
  BrowserRouter,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';

import { isDemo, leaveDemo } from './lib/demo.js';
import { initTheme } from './lib/theme.js';
import { explainSyncError } from './lib/sync-error.js';
import { initAuth, signOut, useAuth } from './store/useAuth.js';
import { loadForUser, useBudget } from './store/useBudget.js';
import { pendingCount } from './lib/ledger.js';

import {
  IconDashboard,
  IconImport,
  IconLedger,
  IconPayees,
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
import Tiers from './pages/Tiers.jsx';
import Review from './pages/Review.jsx';
import Settings from './pages/Settings.jsx';

/*
 * Six onglets dans la barre du bas — un de plus que ce qu'iOS recommande.
 *
 * Le compromis est assumé : sur un iPhone de 393 points, six cibles font 65
 * points de large, ce qui reste au-dessus des 44 points minimum. Les Réglages,
 * qu'on ouvre rarement, restent dans l'en-tête. Si la barre devait s'encombrer
 * davantage, c'est l'Import qui la quitterait : on importe une fois par mois,
 * on consulte tous les jours.
 */
const TABS = [
  { to: '/', label: 'Tableau de bord', short: 'Budget', end: true, Icon: IconDashboard },
  { to: '/ecritures', label: 'Écritures', short: 'Écritures', Icon: IconLedger },
  { to: '/revision', label: 'Révision', short: 'Révision', badge: true, Icon: IconReview },
  { to: '/tiers', label: 'Tiers', short: 'Tiers', Icon: IconPayees },
  { to: '/patrimoine', label: 'Patrimoine', short: 'Patrimoine', Icon: IconWealth },
  { to: '/import', label: 'Import', short: 'Import', Icon: IconImport },
];

const SETTINGS = { to: '/reglages', label: 'Réglages', short: 'Réglages', Icon: IconSettings };

const TITLES = {
  '/': 'Tableau de bord',
  '/ecritures': 'Écritures',
  '/revision': 'Révision',
  '/tiers': 'Tiers',
  '/patrimoine': 'Patrimoine',
  '/import': 'Import',
  '/reglages': 'Réglages',
  '/mot-de-passe': 'Mot de passe',
  '/connexion': 'Connexion',
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

  /*
   * L'application s'ouvre directement sur le journal, sans compte et sans
   * attendre quoi que ce soit du réseau.
   *
   * Il y avait ici trois portes avant d'atteindre le premier écran : une
   * configuration à valider, un état d'authentification à attendre, une
   * connexion à réussir. Chacune pouvait rester fermée — et l'une d'elles l'a
   * été, laissant l'écran d'import inatteignable et l'import « sans effet ».
   * Le cahier des charges tranche : tout reste local, il n'y a donc aucune
   * raison de faire dépendre l'ouverture de l'application d'un serveur.
   *
   * Une session ouverte reste possible et bascule la synchronisation ; son
   * absence n'empêche plus rien.
   */
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Shell local={!session} />
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

function Shell({ local = false }) {
  const demo = isDemo();
  const data = useBudget((s) => s.data);
  const loading = useBudget((s) => s.loading);
  const sync = useBudget((s) => s.sync);
  const error = useBudget((s) => s.error);
  const email = useAuth((s) => s.session?.user?.email);
  const pending = pendingCount(data);
  const location = useLocation();
  const collapsed = useCollapsed();
  const title = TITLES[location.pathname] || 'Budget du ménage';

  // Le journal est chargé dès l'ouverture, avec ou sans compte, et rechargé si
  // une session apparaît ou disparaît.
  const userId = useAuth((s) => s.session?.user?.id ?? null);
  useEffect(() => { void loadForUser(userId); }, [userId]);

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
            ) : local ? (
              // Dire où vivent les données, sans alarmer : c'est l'état normal.
              <span className="pill" title="Vos écritures sont enregistrées dans ce navigateur">
                sur cet appareil
              </span>
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
        {!demo && !local && sync === 'echec' && <SyncAlert message={error} />}
        {loading ? (
          <p className="muted">Chargement de vos écritures…</p>
        ) : (
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/ecritures" element={<Transactions />} />
            <Route path="/revision" element={<Review />} />
            <Route path="/tiers" element={<Tiers />} />
            <Route path="/patrimoine" element={<NetWorth />} />
            <Route path="/import" element={<Import />} />
            <Route path="/reglages" element={<Settings />} />
            <Route path="/mot-de-passe" element={<Password />} />
            {/* La synchronisation reste offerte, elle n'est plus imposée. */}
            <Route path="/connexion" element={<Login />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>
    </>
  );
}

/**
 * L'échec d'enregistrement, dit en toutes lettres et sur tout écran.
 *
 * C'est le pire mode de défaillance de ce produit : l'import affiche des
 * totaux justes, on les croit acquis, et le rechargement suivant les efface.
 * La pastille discrète de l'en-tête ne suffisait pas — elle était même masquée
 * sur téléphone, où l'application est le plus utilisée. Une erreur qu'on ne
 * voit pas est une erreur qui ment.
 */
function SyncAlert({ message }) {
  const { titre, remede } = explainSyncError(message);
  return (
    <div className="note err" role="alert" style={{ marginBottom: 18 }}>
      <strong>{titre}</strong>
      <p style={{ marginTop: 6 }}>
        {remede || message}
      </p>
      <p style={{ marginTop: 6 }}>
        <strong>Vos écritures ne sont pas perdues :</strong> elles sont conservées dans ce
        navigateur et repartiront d’elles-mêmes dès que la base les acceptera. Elles ne sont en
        revanche pas encore accessibles depuis un autre appareil — et une navigation privée
        refermée les emporterait. <em>Réglages → Export et sauvegarde</em> en fait une copie hors
        du navigateur.
      </p>
    </div>
  );
}

