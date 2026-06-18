'use client';
// Query/mutation helpers for the measure-authoring layer. Collaboration only —
// imported by the (lazy, flagged) authoring chunk, never by the static core.
// All writes are RLS-guarded; promotion to `published` goes through the
// validate-and-promote Edge Function (service role), never the client.
import { getSupabase } from './client';
import type { Measure, Scope } from '@/lib/measure/schema';

export interface MeasureRow {
  id: string;
  owner_id: string;
  scope: Scope;
  sector: string | null;
  maturity: string | null;
  schema_version: number;
  model_version: string | null;
  review_status: 'open' | 'accepted' | 'rejected' | 'wontfix';
  data: Measure;
  created_at: string;
  updated_at: string;
}

export interface LibraryRow<T> {
  id: string;
  owner_id: string;
  data: T;
}

// ── measures ─────────────────────────────────────────────────────────────────

/** Measures visible to the caller (published for everyone; own drafts/scenarios). */
export async function listMeasures(): Promise<MeasureRow[]> {
  const { data, error } = await getSupabase()
    .from('measures')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as MeasureRow[];
}

export async function getMeasure(id: string): Promise<MeasureRow | null> {
  const { data, error } = await getSupabase().from('measures').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as unknown as MeasureRow) ?? null;
}

/**
 * Coarse-grained partial upsert (§8 `measure.upsert`) via the SECURITY INVOKER
 * RPC: top-level JSONB merge, RLS + scope guard enforced server-side. Never
 * publishes — `scope` may be 'draft' or 'scenario' only.
 */
export async function upsertMeasure(
  id: string,
  patch: Partial<Measure>,
  scope: Exclude<Scope, 'published'> = 'draft',
): Promise<MeasureRow> {
  const { data, error } = await getSupabase().rpc('measure_upsert', {
    p_id: id,
    p_patch: patch,
    p_scope: scope,
  });
  if (error) throw error;
  return data as unknown as MeasureRow;
}

export async function deleteMeasure(id: string): Promise<void> {
  const { error } = await getSupabase().from('measures').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Ask the server to validate the measure and, if every guardrail passes, promote
 * it to `published`. The Edge Function re-runs validate() server-side (clients
 * cannot set scope=published — RLS + the scope guard forbid it).
 */
export async function requestPromotion(
  id: string,
): Promise<{ promoted: boolean; scope: Scope; checks?: Record<string, string>; missing?: string[] }> {
  const { data, error } = await getSupabase().functions.invoke('validate-and-promote', {
    body: { measure_id: id },
  });
  if (error) throw error;
  return data as { promoted: boolean; scope: Scope; checks?: Record<string, string>; missing?: string[] };
}

// ── library objects (overlay on the file-library base) ─────────────────────────

async function listLibrary<T>(table: 'technologies' | 'resources' | 'products'): Promise<LibraryRow<T>[]> {
  const { data, error } = await getSupabase().from(table).select('id, owner_id, data');
  if (error) throw error;
  return (data ?? []) as unknown as LibraryRow<T>[];
}

export const listTechnologies = () => listLibrary('technologies');
export const listResources = () => listLibrary('resources');
export const listProducts = () => listLibrary('products');

/** Create a library object (the editor's "+"). `kind` applies to technologies only. */
export async function createLibraryObject(
  table: 'technologies' | 'resources' | 'products',
  id: string,
  ownerId: string,
  data: unknown,
  kind?: string,
): Promise<void> {
  const row: Record<string, unknown> = { id, owner_id: ownerId, data };
  if (table === 'technologies' && kind) row.kind = kind;
  const { error } = await getSupabase().from(table).insert(row);
  if (error) throw error;
}
