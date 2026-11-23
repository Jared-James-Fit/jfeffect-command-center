/**
 * Block types, read and written (client side). The library is the built-in
 * types plus the team's own (program_block_types), read with the coach's own
 * login. A database that doesn't have the table yet answers with the built-in
 * types only, so the builder never breaks on an older database.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BUILT_IN_BLOCK_TYPES, blockTypeLibrary, type BlockColor, type BlockMeta, type BlockTypeDef, type BlockTypeRow, type Level } from "@/lib/block-types";

const sb = supabase as any;
export const BLOCK_TYPES_KEY = ["program-block-types"] as const;

/** A column or table the database doesn't have yet (migration not applied). */
export function isMissingSchema(e: any): boolean {
  const code = String(e?.code ?? "");
  return code === "42P01" || code === "42703" || code === "PGRST204" || code === "PGRST205" || /does not exist|schema cache/i.test(String(e?.message ?? ""));
}

export async function listBlockTypeRows(): Promise<{ rows: BlockTypeRow[]; available: boolean }> {
  const { data, error } = await sb
    .from("program_block_types")
    .select("id, builtin_key, name, color, purpose, emphasis, progression, intensity, volume, based_on, archived, sort_order")
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) {
    if (isMissingSchema(error)) return { rows: [], available: false };
    throw error;
  }
  return { rows: (data ?? []) as BlockTypeRow[], available: true };
}

export function useBlockTypeLibrary() {
  const q = useQuery({
    queryKey: BLOCK_TYPES_KEY,
    queryFn: listBlockTypeRows,
    staleTime: 5 * 60_000,
    // a read that failed still leaves the built-in types to pick from
    retry: 1,
  });
  const rows = q.data?.rows ?? [];
  return {
    library: q.data ? blockTypeLibrary(rows) : [...BUILT_IN_BLOCK_TYPES],
    rows,
    available: q.data?.available ?? false,
    loading: q.isLoading,
  };
}

export type BlockTypeDraft = {
  id?: string | null;
  builtinKey?: string | null;
  name: string;
  color: BlockColor;
  purpose?: string;
  emphasis?: string;
  progression?: string;
  intensity?: Level;
  volume?: Level;
  basedOn?: string | null;
  sortOrder?: number | null;
  archived?: boolean;
};

export async function saveBlockType(d: BlockTypeDraft): Promise<string> {
  const row = {
    builtin_key: d.builtinKey ?? null,
    name: d.name.trim().slice(0, 40),
    color: d.color,
    purpose: d.purpose?.trim() || null,
    emphasis: d.emphasis?.trim() || null,
    progression: d.progression?.trim() || null,
    intensity: d.intensity ?? null,
    volume: d.volume ?? null,
    based_on: d.basedOn ?? null,
    sort_order: d.sortOrder ?? null,
    archived: !!d.archived,
  };
  if (!row.name) throw new Error("Give the type a name.");
  if (d.id) {
    const { error } = await sb.from("program_block_types").update(row).eq("id", d.id);
    if (error) throw friendly(error);
    return d.id;
  }
  if (d.builtinKey) {
    // a team override of a built-in type: one row per key
    const { data, error } = await sb.from("program_block_types").upsert(row, { onConflict: "builtin_key" }).select("id").single();
    if (error) throw friendly(error);
    return data.id;
  }
  const { data, error } = await sb.from("program_block_types").insert(row).select("id").single();
  if (error) throw friendly(error);
  return data.id;
}

function friendly(e: any): Error {
  if (isMissingSchema(e)) return new Error("Custom block types aren't set up on this database yet.");
  if (/row-level security|permission/i.test(String(e?.message ?? ""))) return new Error("Only an admin can change the built-in types; add your own instead.");
  return e instanceof Error ? e : new Error(e?.message ?? "Couldn't save the type.");
}

/** A client's block: its type and the coach's words for it. */
export async function setClientBlockType(blockId: string, type: string | null, meta: BlockMeta | null): Promise<void> {
  const clean = meta && Object.values(meta).some((v) => (v ?? "").toString().trim()) ? meta : null;
  const { error } = await sb.from("pl_blocks").update({ block_type: type, block_meta: clean }).eq("id", blockId);
  if (error) throw friendly(error);
}

export function useInvalidateBlockTypes() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: BLOCK_TYPES_KEY });
}

export type { BlockTypeDef };
