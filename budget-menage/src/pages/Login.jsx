import { useState } from 'react';
import { clearError, requestPasswordReset, signIn, signUp, useAuth } from '../store/useAuth.js';

const TITLES = {
  signin: 'Connectez-vous pour retrouver vos écritures.',
  signup: 'Créez un compte : vous seul y aurez accès.',
  forgot: 'Recevez un lien pour choisir un nouveau mot de passe.',
};

export default function Login() {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const error = useAuth((s) => s.error);

  function switchMode(next) {
    setMode(next);
    setNotice('');
    clearError();
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      if (mode === 'forgot') {
        if (await requestPasswordReset(email)) {
          setNotice('Si un compte existe pour cette adresse, le lien vient de partir.');
        }
        return;
      }
      const ok = mode === 'signin' ? await signIn(email, password) : await signUp(email, password);
      if (ok && mode === 'signup') {
        setNotice('Compte créé. Confirmez votre adresse par le lien reçu, puis connectez-vous.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <h1>Budget du ménage</h1>
        <p className="lede">{TITLES[mode]}</p>

        <label className="field">
          Adresse e-mail
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>

        {mode !== 'forgot' && (
          <label className="field">
            Mot de passe
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              minLength={6}
              required
            />
          </label>
        )}

        {error && <p className="note err" style={{ marginBottom: 14 }}>{error}</p>}
        {notice && <p className="note ok" style={{ marginBottom: 14 }}>{notice}</p>}

        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Un instant…' : mode === 'signin' ? 'Se connecter' : mode === 'signup' ? 'Créer le compte' : 'Envoyer le lien'}
        </button>

        <p className="switch">
          <button type="button" onClick={() => switchMode(mode === 'signup' ? 'signin' : mode === 'forgot' ? 'signin' : 'signup')}>
            {mode === 'signin' ? 'Pas encore de compte ? En créer un' : mode === 'signup' ? 'Déjà un compte ? Se connecter' : 'Retour à la connexion'}
          </button>
        </p>
        {mode === 'signin' && (
          <p className="switch">
            <button type="button" onClick={() => switchMode('forgot')}>Mot de passe oublié</button>
          </p>
        )}

        <p className="hint" style={{ textAlign: 'center' }}>
          Vos écritures sont rattachées à votre compte et ne sont lisibles que par lui.
        </p>
      </form>
    </div>
  );
}
