/**
 * Protected server functions for program assignment + row reordering.
 *
 * These wrap transactional Postgres RPCs so multi-table operations either
 * commit fully or roll back together. Every handler authorizes the caller
 * via requireSupabaseAuth + the same admin/assigned-coach check used in
 * src/lib/pl-bulk.functions.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Placement =
  | { mode: "new_prep"; prep?: { title?: string; goal_type?: string; event_name?: string | null; event_date?: string | null } }
  | { mode: "existing_prep"; prepId: string }
  | { mode: "standalone_block" }
  | { mode: "into_block"; blockId: string }
  | { mode: "into_week"; weekId: string }
  | { mode: "into_day"; dayId: string };

interface AssignInput {
  templateId: string;
  clientId: string;
  placement?: Placement;
  name?: string | null;
  clientVisible?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  selectedBlockIds?: string[] | null;
  startFromBlockId?: string | null;
}

async function isAdmin(ctx: { supabase: any; userId: string }): Promise<boolean> {
  const { data } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  return Boolean(data);
}

async function authorizeClient(ctx: { supabase: any; userId: string }, clientId: string) {
  if (!clientId) throw new Error("clientId is required");
  if (await isAdmin(ctx)) return;
  const { data: ok } = await ctx.supabase.rpc("is_assigned_coach", { _client_id: clientId });
  if (!ok) throw new Error("Not authorized to assign programs to this client");
}

export const applyTemplateToClientFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: AssignInput) => {
    if (!d || typeof d !== "object") throw new Error("Invalid input");
    if (!d.templateId) throw new Error("templateId is required");
    if (!d.clientId) throw new Error("clientId is required");
    // When the caller restricts to specific selected block ids, at least one is required.
    if (Array.isArray(d.selectedBlockIds) && d.selectedBlockIds.length === 0) {
      throw new Error("At least one block must be selected for assignment");
    }
    return d;
  })
  .handler(async ({ data, context }): Promise<Record<string, string | null>> => {
    const ctx = { supabase: context.supabase, userId: context.userId };
    await authorizeClient(ctx, data.clientId);

    // SLICE 3 GUARD: until the slice 4+5 assignment RPC + client logger
    // ship together, refuse to assign templates that contain new
    // multi-block prescriptions. The backfill created exactly one
    // "straight" block per row; any row with >1 block, or any block
    // whose type is not "straight", is unsafe to flatten and would
    // either be lost on assign or render incorrectly to the client.
    {
      const { data: rows, error: gErr } = await ctx.supabase
        .from("pl_exercise_rows")
        .select("id, pl_days!inner(pl_weeks!inner(template_id)), pl_exercise_blocks(id, block_type)")
        .eq("pl_days.pl_weeks.template_id", data.templateId);
      if (gErr) throw new Error(gErr.message);
      let bad = 0;
      for (const r of (rows ?? []) as any[]) {
        const blocks = (r.pl_exercise_blocks ?? []) as Array<{ block_type: string }>;
        if (blocks.length > 1) { bad++; continue; }
        if (blocks.length === 1 && blocks[0].block_type !== "straight") { bad++; continue; }
      }
      if (bad > 0) {
        throw new Error(
          `This template uses ${bad} multi-block prescription${bad === 1 ? "" : "s"} (top sets, backoffs, ascending sets, drop sets, warm-ups, or custom blocks). The client-side logger for these blocks ships in the next release. Until then, please remove or convert these blocks to a single Straight Sets prescription before assigning, or assign a different template.`,
        );
      }
    }

    const placement: Placement = data.placement ?? { mode: "standalone_block" };
    const { data: result, error } = await ctx.supabase.rpc("pl_assign_template_to_client", {
      p_template_id: data.templateId,
      p_client_id: data.clientId,
      p_placement: placement as any,
      p_name: data.name ?? null,
      p_client_visible: data.clientVisible ?? true,
      p_start_date: data.startDate ?? null,
      p_end_date: data.endDate ?? null,
      p_selected_block_ids: data.selectedBlockIds ?? null,
      p_start_from_block_id: data.startFromBlockId ?? null,
    } as any);
    if (error) throw new Error(error.message);
    return (result ?? {}) as Record<string, string | null>;
  });

interface MoveRowInput {
  rowId: string;
  direction: "up" | "down";
}

export const moveRowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: MoveRowInput) => {
    if (!d?.rowId) throw new Error("rowId is required");
    if (d.direction !== "up" && d.direction !== "down") {
      throw new Error("direction must be 'up' or 'down'");
    }
    return d;
  })
  .handler(async ({ data, context }): Promise<Array<{ id: string; sort_order: number }>> => {
    const { data: result, error } = await context.supabase.rpc("pl_move_row", {
      p_row_id: data.rowId,
      p_direction: data.direction,
    });
    if (error) throw new Error(error.message);
    return (result ?? []) as Array<{ id: string; sort_order: number }>;
  });