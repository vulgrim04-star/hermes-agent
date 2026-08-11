/**
 * Le garde-fou de construction.
 *
 * Il n'a qu'un travail, et il est irréversible s'il le rate : une clé privée
 * qui entre dans le bundle est publiée à chaque visiteur, et la seule
 * réparation est de la révoquer. Il vaut donc quelques tests, d'autant que
 * Supabase a changé de format de clés en cours de route — c'est exactement le
 * genre de transition où une vérification écrite pour l'ancien format laisse
 * passer le nouveau.
 */

import { describe, expect, it } from 'vitest';

import { assertAnonKey } from '../../vite.config.js';
import { explainSyncError } from './sync-error.js';

/** Fabrique un JWT non signé portant le rôle voulu — seule la charge utile est lue. */
function jwt(role) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', role })}.signature`;
}

describe('assertAnonKey', () => {
  it('laisse passer la clé publishable, faite pour le navigateur', () => {
    const key = 'sb_publishable_d_3MqS8h7s7joJmhnNVGXQ_dF1Hrl7_';
    expect(assertAnonKey(key)).toBe(key);
  });

  it('refuse la clé sb_secret_, qui contourne la RLS', () => {
    expect(() => assertAnonKey('sb_secret_Ab3xY9zQw2')).toThrow(/sb_secret/);
  });

  it('laisse passer un JWT de rôle anon', () => {
    const key = jwt('anon');
    expect(assertAnonKey(key)).toBe(key);
  });

  it('refuse un JWT de rôle service_role', () => {
    expect(() => assertAnonKey(jwt('service_role'))).toThrow(/service_role/);
  });

  it('refuse tout rôle autre qu’anon, y compris un rôle inconnu', () => {
    expect(() => assertAnonKey(jwt('postgres'))).toThrow(/postgres/);
  });

  it('accepte l’absence de clé : c’est une configuration incomplète, pas une fuite', () => {
    expect(assertAnonKey('')).toBe('');
    expect(assertAnonKey(undefined)).toBe('');
  });

  it('laisse passer une chaîne qui n’est ni un JWT ni une clé sb_ — Supabase la rejettera', () => {
    expect(assertAnonKey('bonjour')).toBe('bonjour');
  });

  it('ne se laisse pas berner par une charge utile illisible', () => {
    // Trois segments, mais le milieu n'est pas du JSON : on ne peut rien
    // affirmer, donc on laisse passer plutôt que de bloquer une construction
    // légitime. Supabase refusera la clé de toute façon.
    expect(assertAnonKey('aaa.bbb.ccc')).toBe('aaa.bbb.ccc');
  });
});

describe('explainSyncError', () => {
  it('reconnaît la table absente au code Postgres', () => {
    const r = explainSyncError('relation "public.budget_state" does not exist');
    expect(r.titre).toMatch(/n’existe pas encore/);
    expect(r.remede).toMatch(/schema\.sql/);
  });

  it('reconnaît la formulation de PostgREST, qui ne porte pas le code', () => {
    const r = explainSyncError("Could not find the table 'public.budget_state' in the schema cache");
    expect(r.remede).toMatch(/schema\.sql/);
  });

  it('distingue les policies manquantes de la table manquante', () => {
    const r = explainSyncError('new row violates row-level security policy for table "budget_state"');
    expect(r.titre).toMatch(/règles d’accès/);
    expect(r.remede).toMatch(/policies\.sql/);
    expect(r.remede).not.toMatch(/schema\.sql/);
  });

  it('reconnaît une panne réseau et dit de ne pas recharger', () => {
    expect(explainSyncError('TypeError: Failed to fetch').remede).toMatch(/rechargez/);
  });

  it('n’invente pas de remède pour une cause inconnue', () => {
    const r = explainSyncError('quelque chose d’inattendu');
    expect(r.titre).toMatch(/n’ont pas été enregistrées/);
    expect(r.remede).toBe('');
  });

  it('supporte un message absent sans lever', () => {
    expect(() => explainSyncError(undefined)).not.toThrow();
    expect(explainSyncError(null).remede).toBe('');
  });
});
