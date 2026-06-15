/**
 * Bulk selection + bulk action server functions for the program builders.
 *
 * One shared API used by:
 *   - Program Library template builder
 *   - Client program builder
 *   - Client-assigned training blocks (Full Block view, Weekly view)
 *
 * Safety contract:
 *   - All cloning copies programming columns ONLY. Never touches
 *     pl_row_results, pl_day_completions, lift_videos,
 *     manual_check_in_reviews, pl_client_maxes, analytics, messages.
 *   - Soft archive + soft delete only; permanent delete is blocked when
 *     descendants have any client history (results or completions).
 *   - Permission is enforced server-side: admins see everything,
 *     coaches must be assigned to the destination block's client.
 *   - Idempotency: the caller passes operationId; replaying the same id
 *     returns the original audit row instead of re-running.
 *   - Every operation records one row in pl_bulk_operations for Undo.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Scope = "week" | "day";
type InsertMode = "after" | "before" | "end";

interface BulkResult {
  operationId: string;
  createdIds: string[];
  /** True when this operation was already recorded and the result is from the audit row. */
  replayed?: boolean;
  /** Set when permanent delete was blocked by client history. */
  blocked?: boolean;
  blockedReason?: string;
  /** Conflicting destinations the user should resolve in the UI. */
  conflicts?: Array<{ destinationId: string; reason: string }>;
}

// ---- helpers -------------------------------------------------------------

async function isAdmin(ctx: { supabase: any; userId: string }) {
  const { data } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  return Boolean(data);
}

/** Throws if the user is neither admin nor an assigned coach for every block in the list. */
async function authorizeBlockAccess(
  ctx: { supabase: any; userId: string },
  blockIds: string[],
): Promise<void> {
  const unique = Array.from(new Set(blockIds.filter(Boolean)));
  if (!unique.length) return;
  if (await isAdmin(ctx)) return;
  const { data: blocks, error } = await ctx.supabase
    .from("pl_blocks")
    .select("id, client_id")
    .in("id", unique);
  if (error) throw new Error(error.message);
  if (!blocks || blocks.length !== unique.length) {
    throw new Error("One or more blocks not accessible.");
  }
  for (const b of blocks as any[]) {
    if (!b.client_id) continue; // template-style block with no client
    const { data: ok } = await ctx.supabase.rpc("is_assigned_coach", {
      _client_id: b.client_id,
    });
    if (!ok) throw new Error("Not authorized for one of the selected blocks.");
  }
}

async function recordOperation(
  ctx: { supabase: any; userId: string },
  row: {
    operation_id: string;
    action: string;
    scope: Scope;
    source_ids: string[];
    destination_ids?: string[];
    created_ids?: string[];
    meta?: Record<string, unknown>;
    status?: "completed" | "failed" | "undone";
    error_message?: string | null;
  },
) {
  const { error } = await ctx.supabase.from("pl_bulk_operations").insert({
    operation_id: row.operation_id,
    action: row.action,
    scope: row.scope,
    source_ids: row.source_ids,
    destination_ids: row.destination_ids ?? [],
    created_ids: row.created_ids ?? [],
    meta: row.meta ?? {},
    actor_user_id: ctx.userId,
    status: row.status ?? "completed",
    error_message: row.error_message ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Returns the prior audit row when this operationId was already processed. */
async function findExistingOperation(
  ctx: { supabase: any },
  operationId: string,
) {
  const { data } = await ctx.supabase
    .from("pl_bulk_operations")
    .select("*")
    .eq("operation_id", operationId)
    .maybeSingle();
  return data ?? null;
}

/** Compute the next week_index for an insertion at the requested position. */
async function resolveWeekInsertIndex(
  supabase: any,
  blockId: string,
  insertMode: InsertMode,
  anchorWeekId?: string,
): Promise<number> {
  const { data: siblings } = await supabase
    .from("pl_weeks")
    .select("id, week_index")
    .eq("block_id", blockId)
    .is("deleted_at", null)
    .order("week_index");
  const list = (siblings ?? []) as Array<{ id: string; week_index: number }>;
  const maxIdx = list.length ? Math.max(...list.map((s) => s.week_index)) : 0;
  if (insertMode === "end" || !anchorWeekId) return maxIdx + 1;
  const anchor = list.find((s) => s.id === anchorWeekId);
  if (!anchor) return maxIdx + 1;
  return insertMode === "before" ? anchor.week_index : anchor.week_index + 1;
}

async function shiftWeekIndexesFrom(
  supabase: any,
  blockId: string,
  fromIndex: number,
  by: number,
) {
  const { data: toShift } = await supabase
    .from("pl_weeks")
    .select("id, week_index")
    .eq("block_id", blockId)
    .gte("week_index", fromIndex)
    .order("week_index", { ascending: false });
  for (const w of (toShift ?? []) as any[]) {
    await supabase
      .from("pl_weeks")
      .update({ week_index: w.week_index + by })
      .eq("id", w.id);
  }
}

async function resolveDayInsertIndex(
  supabase: any,
  weekId: string,
  insertMode: InsertMode,
  anchorDayId?: string,
): Promise<number> {
  const { data: siblings } = await supabase
    .from("pl_days")
    .select("id, day_index")
    .eq("week_id", weekId)
    .is("deleted_at", null)
    .order("day_index");
  const list = (siblings ?? []) as Array<{ id: string; day_index: number }>;
  const maxIdx = list.length ? Math.max(...list.map((s) => s.day_index)) : 0;
  if (insertMode === "end" || !anchorDayId) return maxIdx + 1;
  const anchor = list.find((s) => s.id === anchorDayId);
  if (!anchor) return maxIdx + 1;
  return insertMode === "before" ? anchor.day_index : anchor.day_index + 1;
}

async function shiftDayIndexesFrom(
  supabase: any,
  weekId: string,
  fromIndex: number,
  by: number,
) {
  const { data: toShift } = await supabase
    .from("pl_days")
    .select("id, day_index")
    .eq("week_id", weekId)
    .gte("day_index", fromIndex)
    .order("day_index", { ascending: false });
  for (const d of (toShift ?? []) as any[]) {
    await supabase
      .from("pl_days")
      .update({ day_index: d.day_index + by })
      .eq("id", d.id);
  }
}

/** Programming-only field allowlist for exercise rows. Excludes ids/timestamps and any client-result columns. */
const EXERCISE_ROW_CLONE_FIELDS = [
  "exercise_id",
  "exercise_name_override",
  "sort_order",
  "sets",
  "reps_text",
  "measurement_type",
  "duration_seconds",
  "reps_text_backup",
  "duration_seconds_backup",
  "rpe",
  "rir",
  "percentage",
  "percentage_basis",
  "load_kg",
  "load_lb",
  "load_unit",
  "rest_seconds",
  "rest_seconds_override",
  "tempo",
  "time_profile",
  "intensity_techniques",
  "progression_method",
  "notes",
  "purpose_label",
  "card_color",
  "manual_override",
  "override_of_pct",
  "estimated_seconds",
  "estimated_seconds_override",
  // basis_row_id intentionally excluded — it references another row's id
  // which won't exist in the clone target. Caller should remap if needed.
] as const;

/** Clone all rows from sourceDayId into newDayId. Programming columns only. */
async function cloneExerciseRows(
  supabase: any,
  sourceDayId: string,
  newDayId: string,
) {
  const { data: rows } = await supabase
    .from("pl_exercise_rows")
    .select("*")
    .eq("day_id", sourceDayId)
    .order("sort_order");
  // Collect old→new row mappings so we can clone any attached
  // pl_exercise_blocks (+ set_rows + drop_stages) in a single atomic
  // two-pass RPC. Reference_block_ids are remapped server-side; cross-row
  // references that escape this batch fail loudly.
  const blockCloneMappings: Array<{ source_row_id: string; dest_row_id: string }> = [];
  for (const r of (rows ?? []) as any[]) {
    const payload: Record<string, unknown> = { day_id: newDayId };
    for (const f of EXERCISE_ROW_CLONE_FIELDS) {
      if (f in r && r[f] !== undefined) payload[f] = r[f];
    }
    const { data: inserted, error } = await supabase
      .from("pl_exercise_rows")
      .insert(payload)
      .select("id")
      .single();
    if (error || !inserted) throw new Error(`Failed to clone exercise row: ${error?.message ?? "no insert returned"}`);
    blockCloneMappings.push({ source_row_id: r.id, dest_row_id: inserted.id });
  }
  if (blockCloneMappings.length) {
    // pl_clone_blocks_for_rows is SECURITY DEFINER, runs in the same
    // transaction as the row inserts (single SQL call) and remaps every
    // reference_block_id to the freshly inserted siblings. The trigger
    // pl_guard_block_save still fires for each insert: if the dest day
    // belongs to a client-visible program, any non-legacy source blocks
    // cause the whole bulk operation to roll back — exactly the safety
    // contract for slice 3.
    const { error: cloneErr } = await supabase.rpc("pl_clone_blocks_for_rows", {
      p_mappings: blockCloneMappings,
    });
    if (cloneErr) throw new Error(`Failed to clone exercise blocks: ${cloneErr.message}`);
  }
}

/** Clone a single day (and its rows) into targetWeekId at the given dayIndex. Returns the new day id. */
async function cloneDayInto(
  supabase: any,
  sourceDayId: string,
  targetWeekId: string,
  dayIndex: number,
): Promise<string> {
  const { data: src, error } = await supabase
    .from("pl_days")
    .select("*")
    .eq("id", sourceDayId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!src) throw new Error("Source day not found.");
  const { data: newDay, error: insErr } = await supabase
    .from("pl_days")
    .insert({
      week_id: targetWeekId,
      day_index: dayIndex,
      title: src.title ?? null,
      focus: src.focus ?? null,
      notes: src.notes ?? null,
      duration_estimate_min: src.duration_estimate_min ?? null,
      duration_override_min: null, // do not carry per-instance overrides
      duration_source: src.duration_source ?? "auto",
      warmup_mode: src.warmup_mode ?? "auto",
      warmup_protocol_id: src.warmup_protocol_id ?? null,
      source_day_id: sourceDayId,
      is_custom: false,
    })
    .select("id")
    .single();
  if (insErr || !newDay) throw new Error(insErr?.message ?? "Day insert failed.");
  await cloneExerciseRows(supabase, sourceDayId, newDay.id);
  return newDay.id as string;
}

/** Clone a single week (and its days + rows) into targetBlockId at weekIndex. Returns the new week id. */
async function cloneWeekInto(
  supabase: any,
  sourceWeekId: string,
  targetBlockId: string,
  weekIndex: number,
  options: { renamePrefix?: string } = {},
): Promise<string> {
  const { data: src, error } = await supabase
    .from("pl_weeks")
    .select("*")
    .eq("id", sourceWeekId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!src) throw new Error("Source week not found.");
  const { data: newWeek, error: insErr } = await supabase
    .from("pl_weeks")
    .insert({
      block_id: targetBlockId,
      week_index: weekIndex,
      notes: src.notes ?? null,
      training_days: src.training_days ?? [],
    })
    .select("id")
    .single();
  if (insErr || !newWeek) throw new Error(insErr?.message ?? "Week insert failed.");
  const { data: days } = await supabase
    .from("pl_days")
    .select("id, day_index")
    .eq("week_id", sourceWeekId)
    .is("deleted_at", null)
    .order("day_index");
  for (const d of (days ?? []) as any[]) {
    await cloneDayInto(supabase, d.id, newWeek.id as string, d.day_index);
  }
  if (options.renamePrefix) {
    await supabase
      .from("pl_weeks")
      .update({ notes: `${options.renamePrefix} ${src.notes ?? ""}`.trim() })
      .eq("id", newWeek.id);
  }
  return newWeek.id as string;
}

// ---- bulk: duplicate weeks within the same block --------------------------

export const bulkDuplicateWeeks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      operationId: string;
      blockId: string;
      weekIds: string[];
      insertMode: InsertMode;
      anchorWeekId?: string;
    }) => d,
  )
  .handler(async ({ data, context }): Promise<BulkResult> => {
    const ctx = { supabase: context.supabase, userId: context.userId };

    const existing = await findExistingOperation(ctx, data.operationId);
    if (existing) {
      return {
        operationId: data.operationId,
        createdIds: existing.created_ids ?? [],
        replayed: true,
      };
    }

    await authorizeBlockAccess(ctx, [data.blockId]);

    // Validate every selected week belongs to the block.
    const { data: srcWeeks, error: srcErr } = await ctx.supabase
      .from("pl_weeks")
      .select("id, block_id, week_index")
      .in("id", data.weekIds);
    if (srcErr) throw new Error(srcErr.message);
    if (!srcWeeks || srcWeeks.length !== data.weekIds.length) {
      throw new Error("One or more selected weeks could not be loaded.");
    }
    for (const w of srcWeeks as any[]) {
      if (w.block_id !== data.blockId)
        throw new Error("Selected weeks must all belong to the same block.");
    }
    const ordered = [...(srcWeeks as any[])].sort(
      (a, b) => a.week_index - b.week_index,
    );

    const insertAt = await resolveWeekInsertIndex(
      ctx.supabase,
      data.blockId,
      data.insertMode,
      data.anchorWeekId,
    );
    await shiftWeekIndexesFrom(
      ctx.supabase,
      data.blockId,
      insertAt,
      ordered.length,
    );

    const createdIds: string[] = [];
    try {
      let i = 0;
      for (const w of ordered) {
        const newId = await cloneWeekInto(
          ctx.supabase,
          w.id,
          data.blockId,
          insertAt + i,
          { renamePrefix: "Copy of" },
        );
        createdIds.push(newId);
        i++;
      }
    } catch (e: any) {
      // best-effort rollback: remove anything we created and reverse the shift
      if (createdIds.length) {
        await ctx.supabase.from("pl_weeks").delete().in("id", createdIds);
      }
      await shiftWeekIndexesFrom(
        ctx.supabase,
        data.blockId,
        insertAt + ordered.length,
        -ordered.length,
      );
      await recordOperation(ctx, {
        operation_id: data.operationId,
        action: "duplicate",
        scope: "week",
        source_ids: data.weekIds,
        destination_ids: [data.blockId],
        created_ids: [],
        status: "failed",
        error_message: e?.message ?? "unknown",
      });
      throw e;
    }

    await recordOperation(ctx, {
      operation_id: data.operationId,
      action: "duplicate",
      scope: "week",
      source_ids: data.weekIds,
      destination_ids: [data.blockId],
      created_ids: createdIds,
      meta: { insertAt, insertMode: data.insertMode, anchorWeekId: data.anchorWeekId ?? null },
    });

    return { operationId: data.operationId, createdIds };
  });

// ---- bulk: duplicate days into one-or-more target weeks --------------------

export const bulkDuplicateDays = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      operationId: string;
      sourceDayIds: string[];
      targetWeekIds: string[];
      insertMode: InsertMode;
      anchorDayId?: string;
    }) => d,
  )
  .handler(async ({ data, context }): Promise<BulkResult> => {
    const ctx = { supabase: context.supabase, userId: context.userId };

    const existing = await findExistingOperation(ctx, data.operationId);
    if (existing) {
      return {
        operationId: data.operationId,
        createdIds: existing.created_ids ?? [],
        replayed: true,
      };
    }

    // Authorize source days' blocks + target weeks' blocks
    const { data: srcDays } = await ctx.supabase
      .from("pl_days")
      .select("id, day_index, week_id, pl_weeks!inner(block_id)")
      .in("id", data.sourceDayIds);
    if (!srcDays || srcDays.length !== data.sourceDayIds.length) {
      throw new Error("One or more source days could not be loaded.");
    }
    const { data: targetWeeks } = await ctx.supabase
      .from("pl_weeks")
      .select("id, block_id")
      .in("id", data.targetWeekIds);
    if (!targetWeeks || targetWeeks.length !== data.targetWeekIds.length) {
      throw new Error("One or more target weeks could not be loaded.");
    }
    const blockIds = Array.from(
      new Set([
        ...(srcDays as any[]).map((d: any) => d.pl_weeks?.block_id).filter(Boolean),
        ...(targetWeeks as any[]).map((w) => w.block_id),
      ]),
    );
    await authorizeBlockAccess(ctx, blockIds);

    const orderedSrc = [...(srcDays as any[])].sort(
      (a, b) => a.day_index - b.day_index,
    );

    const createdIds: string[] = [];
    try {
      for (const targetWeek of targetWeeks as any[]) {
        const insertAt = await resolveDayInsertIndex(
          ctx.supabase,
          targetWeek.id,
          data.insertMode,
          data.anchorDayId,
        );
        await shiftDayIndexesFrom(
          ctx.supabase,
          targetWeek.id,
          insertAt,
          orderedSrc.length,
        );
        let i = 0;
        for (const d of orderedSrc) {
          const newId = await cloneDayInto(
            ctx.supabase,
            d.id,
            targetWeek.id,
            insertAt + i,
          );
          createdIds.push(newId);
          i++;
        }
      }
    } catch (e: any) {
      if (createdIds.length) {
        await ctx.supabase.from("pl_days").delete().in("id", createdIds);
      }
      await recordOperation(ctx, {
        operation_id: data.operationId,
        action: "duplicate",
        scope: "day",
        source_ids: data.sourceDayIds,
        destination_ids: data.targetWeekIds,
        created_ids: [],
        status: "failed",
        error_message: e?.message ?? "unknown",
      });
      throw e;
    }

    await recordOperation(ctx, {
      operation_id: data.operationId,
      action: "duplicate",
      scope: "day",
      source_ids: data.sourceDayIds,
      destination_ids: data.targetWeekIds,
      created_ids: createdIds,
      meta: { insertMode: data.insertMode, anchorDayId: data.anchorDayId ?? null },
    });

    return { operationId: data.operationId, createdIds };
  });

// ---- bulk: copy weeks to other blocks/templates ----------------------------

type WeekDestination =
  | { kind: "block"; blockId: string; insertMode: InsertMode; anchorWeekId?: string };

export const bulkCopyWeeksToDestinations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      operationId: string;
      weekIds: string[];
      destinations: WeekDestination[];
    }) => d,
  )
  .handler(async ({ data, context }): Promise<BulkResult> => {
    const ctx = { supabase: context.supabase, userId: context.userId };

    const existing = await findExistingOperation(ctx, data.operationId);
    if (existing) {
      return {
        operationId: data.operationId,
        createdIds: existing.created_ids ?? [],
        replayed: true,
      };
    }

    // Source authorization
    const { data: srcWeeks } = await ctx.supabase
      .from("pl_weeks")
      .select("id, block_id, week_index")
      .in("id", data.weekIds);
    if (!srcWeeks || srcWeeks.length !== data.weekIds.length) {
      throw new Error("One or more source weeks could not be loaded.");
    }
    const srcBlockIds = Array.from(
      new Set((srcWeeks as any[]).map((w) => w.block_id)),
    );
    const destBlockIds = data.destinations.map((d) => d.blockId);
    await authorizeBlockAccess(ctx, [...srcBlockIds, ...destBlockIds]);

    const ordered = [...(srcWeeks as any[])].sort(
      (a, b) => a.week_index - b.week_index,
    );

    const createdIds: string[] = [];
    try {
      for (const dest of data.destinations) {
        const insertAt = await resolveWeekInsertIndex(
          ctx.supabase,
          dest.blockId,
          dest.insertMode,
          dest.anchorWeekId,
        );
        await shiftWeekIndexesFrom(
          ctx.supabase,
          dest.blockId,
          insertAt,
          ordered.length,
        );
        let i = 0;
        for (const w of ordered) {
          const newId = await cloneWeekInto(
            ctx.supabase,
            w.id,
            dest.blockId,
            insertAt + i,
          );
          createdIds.push(newId);
          i++;
        }
      }
    } catch (e: any) {
      if (createdIds.length) {
        await ctx.supabase.from("pl_weeks").delete().in("id", createdIds);
      }
      await recordOperation(ctx, {
        operation_id: data.operationId,
        action: "copy",
        scope: "week",
        source_ids: data.weekIds,
        destination_ids: destBlockIds,
        created_ids: [],
        status: "failed",
        error_message: e?.message ?? "unknown",
      });
      throw e;
    }

    await recordOperation(ctx, {
      operation_id: data.operationId,
      action: "copy",
      scope: "week",
      source_ids: data.weekIds,
      destination_ids: destBlockIds,
      created_ids: createdIds,
      meta: { destinations: data.destinations },
    });

    return { operationId: data.operationId, createdIds };
  });

// ---- bulk: archive / restore / soft-delete / restore-from-trash ----------

async function setFlags(
  supabase: any,
  scope: Scope,
  ids: string[],
  patch: Record<string, unknown>,
) {
  const table = scope === "week" ? "pl_weeks" : "pl_days";
  const { error } = await supabase.from(table).update(patch).in("id", ids);
  if (error) throw new Error(error.message);
}

async function authorizeScope(
  ctx: { supabase: any; userId: string },
  scope: Scope,
  ids: string[],
) {
  let blockIds: string[] = [];
  if (scope === "week") {
    const { data } = await ctx.supabase
      .from("pl_weeks")
      .select("id, block_id")
      .in("id", ids);
    blockIds = ((data ?? []) as any[]).map((r) => r.block_id);
  } else {
    const { data } = await ctx.supabase
      .from("pl_days")
      .select("id, pl_weeks!inner(block_id)")
      .in("id", ids);
    blockIds = ((data ?? []) as any[]).map((r) => r.pl_weeks?.block_id).filter(Boolean);
  }
  await authorizeBlockAccess(ctx, blockIds);
}

export const bulkArchive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { operationId: string; scope: Scope; ids: string[] }) => d)
  .handler(async ({ data, context }): Promise<BulkResult> => {
    const ctx = { supabase: context.supabase, userId: context.userId };
    const existing = await findExistingOperation(ctx, data.operationId);
    if (existing) return { operationId: data.operationId, createdIds: [], replayed: true };

    await authorizeScope(ctx, data.scope, data.ids);
    await setFlags(ctx.supabase, data.scope, data.ids, {
      archived: true,
      archived_at: new Date().toISOString(),
      archived_by: context.userId,
    });
    await recordOperation(ctx, {
      operation_id: data.operationId,
      action: "archive",
      scope: data.scope,
      source_ids: data.ids,
    });
    return { operationId: data.operationId, createdIds: [] };
  });

export const bulkRestoreFromArchive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { operationId: string; scope: Scope; ids: string[] }) => d)
  .handler(async ({ data, context }): Promise<BulkResult> => {
    const ctx = { supabase: context.supabase, userId: context.userId };
    const existing = await findExistingOperation(ctx, data.operationId);
    if (existing) return { operationId: data.operationId, createdIds: [], replayed: true };

    await authorizeScope(ctx, data.scope, data.ids);
    await setFlags(ctx.supabase, data.scope, data.ids, {
      archived: false,
      archived_at: null,
      archived_by: null,
    });
    await recordOperation(ctx, {
      operation_id: data.operationId,
      action: "restore",
      scope: data.scope,
      source_ids: data.ids,
    });
    return { operationId: data.operationId, createdIds: [] };
  });

export const bulkSoftDelete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { operationId: string; scope: Scope; ids: string[] }) => d)
  .handler(async ({ data, context }): Promise<BulkResult> => {
    const ctx = { supabase: context.supabase, userId: context.userId };
    const existing = await findExistingOperation(ctx, data.operationId);
    if (existing) return { operationId: data.operationId, createdIds: [], replayed: true };

    await authorizeScope(ctx, data.scope, data.ids);
    await setFlags(ctx.supabase, data.scope, data.ids, {
      deleted_at: new Date().toISOString(),
      deleted_by: context.userId,
    });
    await recordOperation(ctx, {
      operation_id: data.operationId,
      action: "soft_delete",
      scope: data.scope,
      source_ids: data.ids,
    });
    return { operationId: data.operationId, createdIds: [] };
  });

export const bulkRestoreFromTrash = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { operationId: string; scope: Scope; ids: string[] }) => d)
  .handler(async ({ data, context }): Promise<BulkResult> => {
    const ctx = { supabase: context.supabase, userId: context.userId };
    const existing = await findExistingOperation(ctx, data.operationId);
    if (existing) return { operationId: data.operationId, createdIds: [], replayed: true };

    await authorizeScope(ctx, data.scope, data.ids);
    await setFlags(ctx.supabase, data.scope, data.ids, {
      deleted_at: null,
      deleted_by: null,
    });
    await recordOperation(ctx, {
      operation_id: data.operationId,
      action: "restore_trash",
      scope: data.scope,
      source_ids: data.ids,
    });
    return { operationId: data.operationId, createdIds: [] };
  });

/**
 * Permanent delete. Blocked when any descendant has client history
 * (pl_row_results or pl_day_completions). Coach should use Archive instead.
 */
export const bulkPermanentDelete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { operationId: string; scope: Scope; ids: string[] }) => d)
  .handler(async ({ data, context }): Promise<BulkResult> => {
    const ctx = { supabase: context.supabase, userId: context.userId };
    const existing = await findExistingOperation(ctx, data.operationId);
    if (existing) return { operationId: data.operationId, createdIds: [], replayed: true };

    await authorizeScope(ctx, data.scope, data.ids);

    // Resolve day ids under the targets so we can check pl_row_results.
    let dayIds: string[] = [];
    if (data.scope === "day") {
      dayIds = data.ids;
    } else {
      const { data: dRows } = await ctx.supabase
        .from("pl_days")
        .select("id")
        .in("week_id", data.ids);
      dayIds = ((dRows ?? []) as any[]).map((r) => r.id);
    }

    if (dayIds.length) {
      const { count: resultsCount } = await ctx.supabase
        .from("pl_row_results")
        .select("id", { head: true, count: "exact" })
        .in("day_id", dayIds)
        .limit(1);
      const { count: completionsCount } = await ctx.supabase
        .from("pl_day_completions")
        .select("id", { head: true, count: "exact" })
        .in("day_id", dayIds)
        .limit(1);
      if ((resultsCount ?? 0) > 0 || (completionsCount ?? 0) > 0) {
        await recordOperation(ctx, {
          operation_id: data.operationId,
          action: "permanent_delete",
          scope: data.scope,
          source_ids: data.ids,
          status: "failed",
          error_message: "blocked_has_client_history",
        });
        return {
          operationId: data.operationId,
          createdIds: [],
          blocked: true,
          blockedReason: "has_client_history",
        };
      }
    }

    const table = data.scope === "week" ? "pl_weeks" : "pl_days";
    const { error } = await ctx.supabase.from(table).delete().in("id", data.ids);
    if (error) throw new Error(error.message);

    await recordOperation(ctx, {
      operation_id: data.operationId,
      action: "permanent_delete",
      scope: data.scope,
      source_ids: data.ids,
    });
    return { operationId: data.operationId, createdIds: [] };
  });

// ---- Undo ----------------------------------------------------------------

/**
 * Undo a previously recorded bulk operation. Inverses:
 *   - duplicate / copy → delete the createdIds
 *   - archive          → restore archive flags
 *   - restore          → re-archive
 *   - soft_delete      → restore from trash
 *   - restore_trash    → soft delete again
 *   - permanent_delete → cannot be undone
 */
export const undoBulkOperation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { operationId: string }) => d)
  .handler(async ({ data, context }) => {
    const ctx = { supabase: context.supabase, userId: context.userId };
    const { data: op } = await ctx.supabase
      .from("pl_bulk_operations")
      .select("*")
      .eq("operation_id", data.operationId)
      .maybeSingle();
    if (!op) throw new Error("Operation not found.");
    if (op.status === "undone") return { ok: true, already: true };
    if (op.status === "failed") {
      await ctx.supabase
        .from("pl_bulk_operations")
        .update({ status: "undone" })
        .eq("id", op.id);
      return { ok: true };
    }

    const scope = op.scope as Scope;
    const table = scope === "week" ? "pl_weeks" : "pl_days";

    switch (op.action as string) {
      case "duplicate":
      case "copy": {
        if ((op.created_ids ?? []).length) {
          await ctx.supabase.from(table).delete().in("id", op.created_ids);
        }
        break;
      }
      case "archive": {
        await setFlags(ctx.supabase, scope, op.source_ids ?? [], {
          archived: false, archived_at: null, archived_by: null,
        });
        break;
      }
      case "restore": {
        await setFlags(ctx.supabase, scope, op.source_ids ?? [], {
          archived: true,
          archived_at: new Date().toISOString(),
          archived_by: context.userId,
        });
        break;
      }
      case "soft_delete": {
        await setFlags(ctx.supabase, scope, op.source_ids ?? [], {
          deleted_at: null, deleted_by: null,
        });
        break;
      }
      case "restore_trash": {
        await setFlags(ctx.supabase, scope, op.source_ids ?? [], {
          deleted_at: new Date().toISOString(),
          deleted_by: context.userId,
        });
        break;
      }
      case "permanent_delete":
        throw new Error("Permanent deletes cannot be undone.");
      default:
        throw new Error(`Unknown action: ${op.action}`);
    }

    await ctx.supabase
      .from("pl_bulk_operations")
      .update({ status: "undone" })
      .eq("id", op.id);
    return { ok: true };
  });

/** List recent operations the current user can still undo. */
export const listRecentBulkOperations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("pl_bulk_operations")
      .select("*")
      .eq("actor_user_id", context.userId)
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(25);
    return data ?? [];
  });