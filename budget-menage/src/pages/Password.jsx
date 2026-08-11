import { useState } from 'react';
import { updatePassword, useAuth } from '../store/useAuth.js';

/** Page d'atterrissage du lien de réinitialisation envoyé par Supabase. */
export default function Password() {
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const error = useAuth((s) => s.error);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      if (await updatePassword(password)) setDone(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <h1>Nouveau mot de passe</h1>
        <p className="lede">Six caractères au minimum.</p>
        {done ? (
          <p className="note ok">Mot de passe modifié. <a href="/">Revenir à l’application</a></p>
        ) : (
          <>
            <label className="field">
              Mot de passe
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
              />
            </label>
            {error && <p className="note err" style={{ marginBottom: 14 }}>{error}</p>}
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Un instant…' : 'Enregistrer'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
