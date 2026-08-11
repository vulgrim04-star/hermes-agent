/**
 * Session Supabase.
 *
 * Authentification par e-mail et mot de passe, comme sur Cat's Eyes. Aucun
 * jeton n'est stocké par l'application : c'est le client Supabase qui tient la
 * session et la rafraîchit.
 */

import { create } from 'zustand';
import { supabase, configured } from '../lib/supabaseClient.js';
import { loadForUser, flush, setUser } from './useBudget.js';

export const useAuth = create(() => ({ session: null, ready: !configured, error: '' }));

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  useAuth.setState({ error: error ? traduire(error.message) : '' });
  return !error;
}

export async function signUp(email, password) {
  const { error } = await supabase.auth.signUp({ email, password });
  useAuth.setState({ error: error ? traduire(error.message) : '' });
  return !error;
}

export async function requestPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/mot-de-passe',
  });
  useAuth.setState({ error: error ? traduire(error.message) : '' });
  return !error;
}

export async function updatePassword(password) {
  const { error } = await supabase.auth.updateUser({ password });
  useAuth.setState({ error: error ? traduire(error.message) : '' });
  return !error;
}

export async function signOut() {
  // Les modifications en attente partent avant que la session ne se ferme :
  // sans quoi les dernières catégories posées seraient perdues.
  await flush();
  await supabase.auth.signOut();
}

export function clearError() {
  useAuth.setState({ error: '' });
}

/** Les messages de Supabase sont en anglais ; ceux-ci reviennent souvent. */
function traduire(message) {
  const m = String(message);
  if (/invalid login credentials/i.test(m)) return 'Adresse ou mot de passe incorrect.';
  if (/email not confirmed/i.test(m)) return "Adresse pas encore confirmée : ouvrez le lien reçu par e-mail.";
  if (/user already registered/i.test(m)) return 'Un compte existe déjà pour cette adresse.';
  if (/password should be at least/i.test(m)) return 'Mot de passe trop court : six caractères au minimum.';
  if (/rate limit|too many/i.test(m)) return 'Trop de tentatives. Réessayez dans quelques minutes.';
  return m;
}

let started = false;

export function initAuth() {
  if (started || !configured) return;
  started = true;
  supabase.auth.onAuthStateChange(async (_event, session) => {
    const id = session?.user?.id ?? null;
    setUser(id);
    await loadForUser(id);
    useAuth.setState({ session, ready: true });
  });
}
