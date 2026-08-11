import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Dit clairement ce qui manque plutôt que d'échouer sur un `undefined`. */
export const configured = Boolean(url && key);

export const supabase = configured ? createClient(url, key) : null;
