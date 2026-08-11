/**
 * Traduction des échecs d'enregistrement.
 *
 * Une écriture qui n'a pas rejoint le compte est une écriture perdue au premier
 * rechargement. C'est le pire mode de défaillance possible pour ce produit :
 * l'import affiche des totaux justes, l'utilisateur les croit acquis, et tout
 * disparaît. Le silence n'est donc pas une option — et un message de Postgres
 * brut n'en est pas une non plus.
 *
 * On reconnaît les causes qui ont une réponse, et on la donne.
 */

/** La table n'a jamais été créée : `schema.sql` n'a pas été exécuté. */
function tableManquante(message) {
  // Postgres : 42P01 « relation "public.budget_state" does not exist ».
  // PostgREST renvoie parfois seulement « Could not find the table … in the
  // schema cache », sans le code.
  return (
    /42P01/.test(message) ||
    (/budget_state/i.test(message) &&
      /does not exist|n'existe pas|schema cache|not find the table/i.test(message))
  );
}

/** Les policies manquent : la table existe, mais elle refuse tout. */
function policiesManquantes(message) {
  return (
    /42501/.test(message) ||
    /row-level security|violates row-level|permission denied/i.test(message)
  );
}

/**
 * Rend `{ titre, remede }` — `remede` peut être vide quand la cause n'est pas
 * reconnue, auquel cas l'appelant affiche le message d'origine plutôt que de
 * prétendre savoir.
 */
export function explainSyncError(message) {
  const text = String(message || '');

  if (tableManquante(text)) {
    return {
      titre: 'La table qui reçoit vos écritures n’existe pas encore.',
      remede:
        'Dans le SQL Editor de votre projet Supabase, exécuter supabase/schema.sql puis ' +
        'supabase/policies.sql. Tant que ce n’est pas fait, rien de ce que vous importez n’est ' +
        'conservé.',
    };
  }

  if (policiesManquantes(text)) {
    return {
      titre: 'La base refuse l’écriture : les règles d’accès manquent.',
      remede:
        'Exécuter supabase/policies.sql dans le SQL Editor. La table existe mais, sans policy, ' +
        'la sécurité au niveau des lignes bloque tout — y compris votre propre compte.',
    };
  }

  if (/fetch|network|failed to fetch|timeout/i.test(text)) {
    return {
      titre: 'Le serveur est injoignable.',
      remede: 'Vos écritures sont encore à l’écran mais pas enregistrées. Ne rechargez pas la page.',
    };
  }

  return { titre: 'Vos écritures n’ont pas été enregistrées.', remede: '' };
}
