/**
 * Quick Notes storage (table `quick_notes`). Each row belongs to one person and
 * only they can read or change it (RLS), so notes follow the person across
 * devices and never show up for anyone else, including "view as".
 */
import { supabase } from "@/integrations/supabase/client";

export type QuickNoteRow = {
  id: string;
  owner_user_id: string;
  title: string;
  body: string;
  client_id: string | null;
  client_name: string | null;
  deleted_at: string | null;
  updated_at: string;
};

/** The note shape the Quick Notes panel works with (times in ms). */
export type StoredNote = {
  id: string; title: string; body: string; updatedAt: number; deletedAt?: number;
  clientId?: string; clientName?: string;
};

const table = () => (supabase as any).from("quick_notes");
const COLS = "id, owner_user_id, title, body, client_id, client_name, deleted_at, updated_at";

export function rowToNote(r: QuickNoteRow): StoredNote {
  const n: StoredNote = { id: r.id, title: r.title ?? "", body: r.body ?? "", updatedAt: Date.parse(r.updated_at) || 0 };
  if (r.deleted_at) n.deletedAt = Date.parse(r.deleted_at);
  if (r.client_id) { n.clientId = r.client_id; n.clientName = r.client_name ?? undefined; }
  return n;
}

export function noteToRow(n: StoredNote, ownerUserId: string): QuickNoteRow {
  return {
    id: n.id,
    owner_user_id: ownerUserId,
    title: n.title,
    body: n.body,
    client_id: n.clientId ?? null,
    client_name: n.clientId ? (n.clientName ?? null) : null,
    deleted_at: n.deletedAt ? new Date(n.deletedAt).toISOString() : null,
    updated_at: new Date(n.updatedAt || Date.now()).toISOString(),
  };
}

/** What the database copy must match; a note is saved when this changes. */
export function noteSignature(n: StoredNote) {
  return JSON.stringify([n.title, n.body, n.updatedAt, n.deletedAt ?? null, n.clientId ?? null, n.clientId ? n.clientName ?? null : null]);
}

export async function fetchMyQuickNotes(): Promise<StoredNote[]> {
  const { data, error } = await table().select(COLS).order("updated_at", { ascending: false }).limit(2000);
  if (error) throw error;
  return ((data ?? []) as QuickNoteRow[]).map(rowToNote);
}

export async function upsertQuickNotes(notes: StoredNote[], ownerUserId: string): Promise<void> {
  if (!notes.length) return;
  const { error } = await table().upsert(notes.map((n) => noteToRow(n, ownerUserId)), { onConflict: "id" });
  if (error) throw error;
}

export async function deleteQuickNotes(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await table().delete().in("id", ids);
  if (error) throw error;
}
