import { Link } from 'react-router-dom';

import { IconChevron, IconImport, IconReview, IconSettings } from '../components/Icons.jsx';
import { leaveDemo } from '../lib/demo.js';
import { pendingCount } from '../lib/ledger.js';
import { signOut } from '../store/useAuth.js';
import { useBudget } from '../store/useBudget.js';

/**
 * L'écran de débordement.
 *
 * Une barre d'onglets à cinq entrées suppose un endroit où ranger le reste.
 * Ce n'est pas un fourre-tout : ce sont les écrans qu'on ouvre une fois par
 * mois — importer un relevé, trancher ce qui reste, régler l'application —
 * contre les quatre qu'on ouvre tous les jours.
 *
 * Le nombre d'écritures à trancher est affiché ici **et** en pastille sur
 * l'onglet : un travail en attente qui disparaît de la vue ne se fait jamais.
 */
export default function More({ local = false, demo = false, email = null }) {
  const data = useBudget((s) => s.data);
  const pending = pendingCount(data);

  return (
    <>
      <div className="block">
        <ul className="menu">
          <Ligne to="/revision" Icon={IconReview} titre="Révision"
            sous={pending.total > 0
              ? `${pending.total} écriture(s) à trancher`
              : 'rien en attente'}
            marque={pending.total > 0 ? pending.total : null} />
          <Ligne to="/import" Icon={IconImport} titre="Importer un relevé"
            sous="CSV ou MT940, lu dans ce navigateur" />
          <Ligne to="/reglages" Icon={IconSettings} titre="Réglages"
            sous="thème, budgets, règles, export et sauvegarde" />
        </ul>
      </div>

      <div className="block">
        <header>
          <div className="grow">
            <h3>Vos données</h3>
            <p>
              {demo
                ? 'Vous parcourez un jeu de démonstration : rien de ce que vous voyez ne vous appartient.'
                : local
                  ? 'Tout est enregistré dans ce navigateur. Rien n’est envoyé nulle part — et une navigation privée refermée emporterait le journal.'
                  : `Synchronisé avec votre compte ${email || ''}.`}
            </p>
          </div>
        </header>
        <div className="body">
          <div className="row">
            <Link className="btn" to="/reglages">Exporter une sauvegarde</Link>
            {demo && <button type="button" className="btn danger" onClick={leaveDemo}>Quitter la démonstration</button>}
            {!demo && !local && (
              <button type="button" className="btn danger" onClick={() => void signOut()}>
                Se déconnecter
              </button>
            )}
            {!demo && local && <Link className="btn quiet" to="/connexion">Synchroniser avec un compte</Link>}
          </div>
        </div>
      </div>
    </>
  );
}

function Ligne({ to, Icon, titre, sous, marque = null }) {
  return (
    <li>
      <Link to={to}>
        <Icon />
        <span className="grow">
          {titre}
          <small>{sous}</small>
        </span>
        {marque !== null && <span className="pill err">{marque}</span>}
        <IconChevron className="chev" />
      </Link>
    </li>
  );
}
