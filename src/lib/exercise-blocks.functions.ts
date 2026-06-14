/**
 * Server functions for the normalized exercise-block schema
 * (`pl_exercise_blocks` + `pl_block_set_rows` + `pl_block_drop_stages`).
 *
 * Slice 3 scope:
 *   - `listBlocksForRowFn(rowId)` returns the ordered block list for a
 *     single exercise row, including child set rows and drop stages.
 *   - `saveBlocksForRowFn(rowId, blocks)` performs a diff-and-apply
 *     persist for one row: upserts blocks/set_rows/drop_stages and
 *     deletes any that the coach removed. Operations are sequential
 *     (no cross-table transaction), but the only consumers in slice 3
 *     are the builder dialog and the assignment guard — the client
 *     logger does not read this schema yet.
 *   - `countNonLegacyBlocksFn(templateId)` powers the assignment guard
 *     in `applyTemplateToClientFn`: any row with >1 block, or any
 *     block whose type is not "straight", is "non-legacy" and not yet
 *     safe to assign (the client logger ships in slices 4+5).
 *
 * Authorization mirrors `pl-programs.functions.ts`: admin OR assigned
 * coach for the owning client. Template rows are coach-owned via
 * `pl_templates.coach_id` (admin always passes).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  type ExerciseBlock,
  type BlockSetRow,
  type BlockDropStage,
  type BlockType,
  BLOCK_TYPES,
} from "@/lib/exercise-blocks";

async function isAdmin(ctx: { supabase: any; userId: string }): Promise<boolean> {
  const { data } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  return Boolean(data);
}

/** Resolve the owning client id (if any) for a row, or null for template rows. */
async function rowOwnerClientId(ctx: { supabase: any }, rowId: string): Promise<string | null> {
  const { data, error } = await ctx.supabase
    .from("pl_exercise_rows")
    .select("id, pl_days!inner(pl_weeks!inner(pl_blocks!inner(client_id)))")
    .eq("id", rowId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as any)?.pl_days?.pl_weeks?.pl_blocks?.client_id ?? null;
}

async function authorizeRow(ctx: { supabase: any; userId: string }, rowId: string) {
  if (await isAdmin(ctx)) return;
  const clientId = await rowOwnerClientId(ctx, rowId);
  if (clientId) {
    const { data: ok } = await ctx.supabase.rpc("is_assigned_coach", { _client_id: clientId });
    if (!ok) throw new Error("Not authorized to edit this exercise row");
    return;
  }
  // Template row: only admin (covered above) or template owner can edit.
  // RLS on pl_exercise_blocks already enforces this on write; we just need
  // a friendlier error than a Postgres 42501.
  const { data: tmpl, error } = await ctx.supabase
    .from("pl_exercise_rows")
    .select("id, pl_days!inner(pl_weeks!inner(pl_templates!inner(coach_id)))")
    .eq("id", rowId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const coachId = (tmpl as any)?.pl_days?.pl_weeks?.pl_templates?.coach_id;
  if (!coachId || coachId !== ctx.userId) {
    throw new Error("Not authorized to edit this template row");
  }
}

export const listBlocksForRowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { rowId: string }) => {
    if (!d?.rowId) throw new Error("rowId is required");
    return d;
  })
  .handler(async ({ data, context }): Promise<ExerciseBlock[]> => {
    const ctx = { supabase: context.supabase, userId: context.userId };
    await authorizeRow(ctx, data.rowId);

    const { data: blocks, error } = await ctx.supabase
      .from("pl_exercise_blocks")
      .select("*")
      .eq("row_id", data.rowId)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    const blockList = (blocks ?? []) as any[];
    if (blockList.length === 0) return [];

    const ids = blockList.map((b) => b.id);
    const [setRowsRes, dropsRes] = await Promise.all([
      ctx.supabase
        .from("pl_block_set_rows")
        .select("*")
        .in("block_id", ids)
        .order("sort_order", { ascending: true }),
      ctx.supabase
        .from("pl_block_drop_stages")
        .select("*")
        .in("block_id", ids)
        .order("sort_order", { ascending: true }),
    ]);
    if (setRowsRes.error) throw new Error(setRowsRes.error.message);
    if (dropsRes.error) throw new Error(dropsRes.error.message);

    const byBlockSet = new Map<string, BlockSetRow[]>();
    for (const r of (setRowsRes.data ?? []) as any[]) {
      if (!byBlockSet.has(r.block_id)) byBlockSet.set(r.block_id, []);
      byBlockSet.get(r.block_id)!.push({
        id: r.id,
        sort_order: r.sort_order,
        reps_text: r.reps_text,
        load_value: r.load_value == null ? null : Number(r.load_value),
        load_unit: r.load_unit,
        rpe: r.rpe,
        rir: r.rir,
        amrap: !!r.amrap,
      });
    }
    const byBlockDrop = new Map<string, BlockDropStage[]>();
    for (const s of (dropsRes.data ?? []) as any[]) {
      if (!byBlockDrop.has(s.block_id)) byBlockDrop.set(s.block_id, []);
      byBlockDrop.get(s.block_id)!.push({
        id: s.id,
        sort_order: s.sort_order,
        reduction_type: s.reduction_type,
        reduction_value: s.reduction_value == null ? null : Number(s.reduction_value),
        reps_text: s.reps_text,
        rpe: s.rpe,
        rir: s.rir,
        amrap: !!s.amrap,
        rest_seconds: s.rest_seconds,
      });
    }

    return blockList.map((b) => ({
      id: b.id,
      row_id: b.row_id,
      sort_order: b.sort_order,
      block_type: b.block_type as BlockType,
      label: b.label,
      sets: b.sets,
      reps_text: b.reps_text,
      rpe: b.rpe,
      rir: b.rir,
      load_type: b.load_type,
      load_value: b.load_value == null ? null : Number(b.load_value),
      load_unit: b.load_unit,
      reference_block_id: b.reference_block_id,
      rest_seconds_override: b.rest_seconds_override,
      tempo: b.tempo,
      amrap: !!b.amrap,
      notes: b.notes,
      config: (b.config as Record<string, any>) ?? {},
      set_rows: byBlockSet.get(b.id) ?? [],
      drop_stages: byBlockDrop.get(b.id) ?? [],
    }));
  });

interface SaveInput {
  rowId: string;
  blocks: ExerciseBlock[];
}

function isUuid(s: string | null | undefined): boolean {
  return !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export const saveBlocksForRowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: SaveInput) => {
    if (!d?.rowId) throw new Error("rowId is required");
    if (!Array.isArray(d.blocks)) throw new Error("blocks must be an array");
    for (const b of d.blocks) {
      if (!BLOCK_TYPES.includes(b.block_type)) {
        throw new Error(`Unsupported block_type: ${b.block_type}`);
      }
    }
    return d;
  })
  .handler(async ({ data, context }): Promise<ExerciseBlock[]> => {
    const ctx = { supabase: context.supabase, userId: context.userId };
    await authorizeRow(ctx, data.rowId);

    // Snapshot current state to compute deletes.
    const { data: existing, error: exErr } = await ctx.supabase
      .from("pl_exercise_blocks")
      .select("id")
      .eq("row_id", data.rowId);
    if (exErr) throw new Error(exErr.message);
    const existingIds = new Set(((existing ?? []) as any[]).map((b) => b.id));

    // Build a stable id map: any incoming block whose id is not a
    // UUID (or doesn't exist server-side) is treated as new and gets a
    // fresh server-generated id via insert. We keep a local oldId→newId
    // map so `reference_block_id` survives the round trip.
    const idMap = new Map<string, string>();
    const keepIds = new Set<string>();

    // Pass 1: upsert blocks (without reference_block_id yet, to avoid
    // forward references to siblings that haven't been inserted).
    for (let i = 0; i < data.blocks.length; i++) {
      const b = data.blocks[i];
      const payload: any = {
        row_id: data.rowId,
        sort_order: i,
        block_type: b.block_type,
        label: b.label,
        sets: b.sets,
        reps_text: b.reps_text,
        rpe: b.rpe,
        rir: b.rir,
        load_type: b.load_type,
        load_value: b.load_value,
        load_unit: b.load_unit,
        reference_block_id: null,
        rest_seconds_override: b.rest_seconds_override,
        tempo: b.tempo,
        amrap: !!b.amrap,
        notes: b.notes,
        config: b.config ?? {},
      };
      if (isUuid(b.id) && existingIds.has(b.id)) {
        const { error } = await ctx.supabase
          .from("pl_exercise_blocks")
          .update(payload)
          .eq("id", b.id);
        if (error) throw new Error(error.message);
        idMap.set(b.id, b.id);
        keepIds.add(b.id);
      } else {
        const { data: ins, error } = await ctx.supabase
          .from("pl_exercise_blocks")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        idMap.set(b.id, ins.id);
        keepIds.add(ins.id);
      }
    }

    // Pass 2: write reference_block_id now that every sibling has an id.
    for (const b of data.blocks) {
      if (!b.reference_block_id) continue;
      const newId = idMap.get(b.id);
      const refNewId = idMap.get(b.reference_block_id) ?? (isUuid(b.reference_block_id) ? b.reference_block_id : null);
      if (!newId || !refNewId) continue;
      const { error } = await ctx.supabase
        .from("pl_exercise_blocks")
        .update({ reference_block_id: refNewId })
        .eq("id", newId);
      if (error) throw new Error(error.message);
    }

    // Delete blocks the coach removed (cascades wipe set_rows + drop_stages).
    const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
    if (toDelete.length) {
      const { error } = await ctx.supabase
        .from("pl_exercise_blocks")
        .delete()
        .in("id", toDelete);
      if (error) throw new Error(error.message);
    }

    // Pass 3: replace set_rows + drop_stages per block (small N, safe to
    // delete-then-insert; cascade already removed orphans for deleted blocks).
    for (const b of data.blocks) {
      const newBlockId = idMap.get(b.id)!;
      // set_rows (ascending / warmup)
      const setRows = b.set_rows ?? [];
      const { error: delSR } = await ctx.supabase
        .from("pl_block_set_rows")
        .delete()
        .eq("block_id", newBlockId);
      if (delSR) throw new Error(delSR.message);
      if (setRows.length) {
        const rows = setRows.map((r, i) => ({
          block_id: newBlockId,
          sort_order: i,
          reps_text: r.reps_text,
          load_value: r.load_value,
          load_unit: r.load_unit,
          rpe: r.rpe,
          rir: r.rir,
          amrap: !!r.amrap,
        }));
        const { error: insSR } = await ctx.supabase.from("pl_block_set_rows").insert(rows);
        if (insSR) throw new Error(insSR.message);
      }
      // drop_stages (drop set)
      const stages = b.drop_stages ?? [];
      const { error: delDS } = await ctx.supabase
        .from("pl_block_drop_stages")
        .delete()
        .eq("block_id", newBlockId);
      if (delDS) throw new Error(delDS.message);
      if (stages.length) {
        const rows = stages.map((s, i) => ({
          block_id: newBlockId,
          sort_order: i,
          reduction_type: s.reduction_type,
          reduction_value: s.reduction_value,
          reps_text: s.reps_text,
          rpe: s.rpe,
          rir: s.rir,
          amrap: !!s.amrap,
          rest_seconds: s.rest_seconds,
        }));
        const { error: insDS } = await ctx.supabase.from("pl_block_drop_stages").insert(rows);
        if (insDS) throw new Error(insDS.message);
      }
    }

    // Re-fetch the canonical state so the client gets server-generated ids.
    return (await listBlocksForRowFn({ data: { rowId: data.rowId } })) as ExerciseBlock[];
  });

/**
 * Counts blocks in a template/block/prep that are "non-legacy" — i.e.
 * either a non-straight block_type or a row that has more than one
 * block. The single Straight block per row created by the backfill
 * (and the synthesized legacy block for rows with zero blocks) is
 * always safe; anything else requires the slice 4+5 assignment RPC
 * + client logger to ship together.
 */
export const countNonLegacyTemplateBlocksFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { templateId: string }) => {
    if (!d?.templateId) throw new Error("templateId is required");
    return d;
  })
  .handler(async ({ data, context }): Promise<{ rowIds: string[]; total: number }> => {
    const { data: rows, error } = await context.supabase
      .from("pl_exercise_rows")
      .select("id, pl_days!inner(pl_weeks!inner(template_id)), pl_exercise_blocks(id, block_type)")
      .eq("pl_days.pl_weeks.template_id", data.templateId);
    if (error) throw new Error(error.message);
    const bad: string[] = [];
    for (const r of (rows ?? []) as any[]) {
      const blocks = (r.pl_exercise_blocks ?? []) as Array<{ block_type: string }>;
      if (blocks.length > 1) bad.push(r.id);
      else if (blocks.length === 1 && blocks[0].block_type !== "straight") bad.push(r.id);
    }
    return { rowIds: bad, total: bad.length };
  });