/**
 * Program history for Cleo's changes: a restore point taken right before a
 * program or nutrition change runs, and the undo that puts it back.
 * Server-only.
 *
 * - Version rows (pl_program_versions) are written with the service key, after
 *   the action itself was allowed; the restore's data writes use the
 *   restorer's own session, so it can't do more than the app's own buttons.
 * - Logged training is never rewritten: a day the client has started or
 *   logged since keeps what they trained (correct_logged_exercise only puts
 *   back which exercise the row was; its sets were never touched).
 * - Undoing takes a restore point of the current state first, so an undo can
 *   itself be undone.
 */
import type { CleoActionKind } from "@/lib/cleo-actions";

type Db = any;

/** Kinds that get a restore point. */
export const VERSIONED_KINDS = [
  "edit_program_day", "add_workout", "move_workout", "correct_logged_exercise",
  "publish_program", "build_program", "assign_program_template", "set_nutrition_targets",
] as const;
export type VersionedKind = (typeof VERSIONED_KINDS)[number];
export function isVersionedKind(k: string): k is VersionedKind {
  return (VERSIONED_KINDS as readonly string[]).includes(k);
}

/** Row columns a restore never writes. */
const ROW_KEEP = new Set(["id", "day_id", "created_at", "updated_at"]);

export type Snapshot = {
  v: 1;
  /** Program days as they were: their rows, in order. */
  days?: Array<{ id: string; rows: any[] }>;
  /** correct_logged_exercise: which exercise the row was. */
  row?: { id: string; exercise_id: string | null; exercise_name_override: string | null; time_profile: string | null };
  /** publish_program: visibility before. */
  block?: { id: string; client_visible: boolean };
  /** move_workout: where it was. */
  scheduled?: { id: string; scheduled_date: string; scheduled_time: string | null; order_index: number | null };
  /** set_nutrition_targets: the targets before (null = there were none). */
  nutrition?: { target: any | null };
  /** What the change created (add_workout's day, a new block). */
  created?: { day_id?: string; block_id?: string };
};

async function service(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function clientOfDay(db: Db, dayId: string): Promise<{ client_id: string | null; block_id: string | null }> {
  const { data: d } = await db.from("pl_days").select("week_id").eq("id", dayId).maybeSingle();
  if (!d) return { client_id: null, block_id: null };
  const { data: w } = await db.from("pl_weeks").select("block_id").eq("id", d.week_id).maybeSingle();
  if (!w) return { client_id: null, block_id: null };
  const { data: b } = await db.from("pl_blocks").select("client_id").eq("id", w.block_id).maybeSingle();
  return { client_id: b?.client_id ?? null, block_id: w.block_id };
}

async function dayRows(db: Db, dayIds: string[]) {
  if (!dayIds.length) return [];
  const { data, error } = await db.from("pl_exercise_rows").select("*").in("day_id", dayIds).order("sort_order");
  if (error) throw new Error(error.message);
  return dayIds.map((id) => ({ id, rows: ((data ?? []) as any[]).filter((r) => r.day_id === id) }));
}

export type Capture = { clientId: string; blockId: string | null; snapshot: Snapshot; startedAt: string };

/** The restore point, read just before the change runs. Null when there's nothing to keep. */
export async function captureBefore(sb: Db, kind: CleoActionKind, p: any): Promise<Capture | null> {
  if (!isVersionedKind(kind)) return null;
  const startedAt = new Date(Date.now() - 1000).toISOString();
  const program = await import("@/lib/cleo-program.server");
  switch (kind) {
    case "edit_program_day": {
      const t = await program.targetDays(sb, p.day_id, p.scope ?? "this");
      const owner = await clientOfDay(sb, p.day_id);
      if (!owner.client_id) return null;
      return { clientId: owner.client_id, blockId: owner.block_id, snapshot: { v: 1, days: await dayRows(sb, t.days.map((d: any) => d.id)) }, startedAt };
    }
    case "correct_logged_exercise": {
      const { data: row } = await sb.from("pl_exercise_rows").select("id, day_id, exercise_id, exercise_name_override, time_profile").eq("id", p.row_id).maybeSingle();
      if (!row) return null;
      const owner = await clientOfDay(sb, row.day_id);
      if (!owner.client_id) return null;
      const { day_id: _d, ...keep } = row;
      return { clientId: owner.client_id, blockId: owner.block_id, snapshot: { v: 1, row: keep }, startedAt };
    }
    case "publish_program": {
      const { data: b } = await sb.from("pl_blocks").select("id, client_id, client_visible").eq("id", p.block_id).maybeSingle();
      if (!b) return null;
      return { clientId: b.client_id, blockId: b.id, snapshot: { v: 1, block: { id: b.id, client_visible: !!b.client_visible } }, startedAt };
    }
    case "move_workout": {
      const { data: s } = await sb.from("pl_scheduled_workouts").select("id, client_id, scheduled_date, scheduled_time, order_index").eq("id", p.workout_id).maybeSingle();
      if (!s) return null;
      const { client_id, ...scheduled } = s;
      return { clientId: client_id, blockId: null, snapshot: { v: 1, scheduled }, startedAt };
    }
    case "set_nutrition_targets":
      return { clientId: p.client_id, blockId: null, snapshot: { v: 1, nutrition: { target: await program.currentTargets(sb, p.client_id) } }, startedAt };
    case "add_workout":
    case "build_program":
    case "assign_program_template":
      return { clientId: p.client_id, blockId: p.block_id ?? null, snapshot: { v: 1 }, startedAt };
  }
}

/** After it ran: note what it created, then save the restore point. Never throws. */
export async function saveVersion(sb: Db, cap: Capture, kind: CleoActionKind, p: any, summary: string, actionId: string | null, userId: string) {
  try {
    const snapshot: Snapshot = { ...cap.snapshot };
    if (kind === "add_workout") {
      const { data } = await sb
        .from("pl_days")
        .select("id, created_at")
        .eq("title", p.title)
        .eq("scheduled_date", p.date)
        .eq("is_custom", true)
        .gte("created_at", cap.startedAt)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) snapshot.created = { day_id: data.id };
    }
    if (kind === "build_program" || kind === "assign_program_template") {
      const { data } = await sb.from("pl_blocks").select("id").eq("client_id", cap.clientId).gte("created_at", cap.startedAt).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (data) snapshot.created = { block_id: data.id };
    }
    const admin = await service();
    await admin.from("pl_program_versions").insert({
      client_id: cap.clientId,
      block_id: snapshot.created?.block_id ?? cap.blockId,
      kind,
      summary: summary.slice(0, 2000),
      payload: snapshot,
      source: "cleo",
      cleo_action_id: actionId,
      created_by: userId,
    });
  } catch (e) {
    console.warn("[cleo] program history save failed", e);
  }
}

export type VersionView = {
  id: string;
  kind: string;
  summary: string;
  createdAt: string;
  restoredAt: string | null;
  canUndo: boolean;
};

export function toVersionView(v: any): VersionView {
  return {
    id: v.id,
    kind: v.kind,
    summary: v.summary,
    createdAt: v.created_at,
    restoredAt: v.restored_at ?? null,
    canUndo: !v.restored_at && v.kind !== "restore",
  };
}

/** A client's history, newest first (what Cleo and the card see). */
export async function listVersions(db: Db, clientId: string, limit = 20): Promise<VersionView[]> {
  const { data, error } = await db.from("pl_program_versions").select("*").eq("client_id", clientId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map(toVersionView);
}

/** What undoing this version will do, in words (the restore card). */
export async function describeRestore(db: Db, versionId: string): Promise<string> {
  const v = await getVersion(db, versionId);
  if (v.restored_at) throw new Error("That change was already undone.");
  const when = new Date(v.created_at).toLocaleString("en-CA", { timeZone: "America/Winnipeg", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const what = String(v.summary).split("\n")[0].replace(/[.:]$/, "");
  const how: Record<string, string> = {
    edit_program_day: "Put the workout back the way it was before",
    correct_logged_exercise: "Put the exercise back to what it was (logged sets stay as entered)",
    publish_program: "Put the block's visibility back",
    move_workout: "Move the workout back to its old date",
    set_nutrition_targets: "Put the nutrition targets back",
    add_workout: "Remove the added workout (only if it hasn't been started)",
    build_program: "Hide the new block from the client (it stays in their training to delete if you want)",
    assign_program_template: "Hide the assigned block from the client (it stays in their training to delete if you want)",
  };
  return `${how[v.kind] ?? "Undo"}.\nUndoing: ${what} (${when}).`;
}

async function getVersion(db: Db, id: string) {
  const { data, error } = await db.from("pl_program_versions").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("I couldn't find that change in the program history.");
  return data as any;
}

/** Put days' rows back. Started or logged days are skipped (they stay as trained). */
async function restoreDays(sb: Db, days: NonNullable<Snapshot["days"]>): Promise<{ restored: number; skipped: number }> {
  const program = await import("@/lib/cleo-program.server");
  const locked = await program.lockedDays(sb, days.map((d) => d.id));
  let restored = 0;
  for (const day of days) {
    if (locked.has(day.id)) continue;
    const { data: now } = await sb.from("pl_exercise_rows").select("id").eq("day_id", day.id);
    const keepIds = new Set(day.rows.map((r) => r.id));
    // Rows added since: gone (the day has no logged sets, checked above).
    const extra = ((now ?? []) as any[]).map((r) => r.id).filter((id) => !keepIds.has(id));
    if (extra.length) {
      const { error } = await sb.from("pl_exercise_rows").delete().in("id", extra);
      if (error) throw new Error(error.message);
    }
    const nowIds = new Set(((now ?? []) as any[]).map((r) => r.id));
    for (const r of day.rows) {
      if (nowIds.has(r.id)) {
        const patch = Object.fromEntries(Object.entries(r).filter(([k]) => !ROW_KEEP.has(k)));
        const { error } = await sb.from("pl_exercise_rows").update(patch).eq("id", r.id);
        if (error) throw new Error(error.message);
      } else {
        const { created_at: _c, updated_at: _u, ...row } = r;
        const { error } = await sb.from("pl_exercise_rows").insert(row);
        if (error) throw new Error(error.message);
      }
    }
    restored++;
  }
  return { restored, skipped: days.length - restored };
}

/** Undo one change with the restorer's own session. Returns what happened, in words. */
export async function restoreVersion(actor: { supabase: Db; userId: string }, versionId: string): Promise<string> {
  const sb = actor.supabase;
  const admin = await service();
  const v = await getVersion(admin, versionId);
  if (v.restored_at) throw new Error("That change was already undone.");
  // Claim it first so a double tap can't run it twice.
  const { data: claimed } = await admin
    .from("pl_program_versions")
    .update({ restored_at: new Date().toISOString(), restored_by: actor.userId })
    .eq("id", versionId)
    .is("restored_at", null)
    .select("id")
    .maybeSingle();
  if (!claimed) throw new Error("That change was already undone.");
  const snap = (v.payload ?? {}) as Snapshot;
  try {
    let text: string;
    switch (v.kind) {
      case "edit_program_day": {
        const days = snap.days ?? [];
        // Restore point of the current state, so the undo can be undone too.
        const current = await dayRows(sb, days.map((d) => d.id));
        const r = await restoreDays(sb, days);
        if (!r.restored) throw new Error("That workout has been started or logged since, so it stays as trained.");
        await admin.from("pl_program_versions").insert({ client_id: v.client_id, block_id: v.block_id, kind: "edit_program_day", summary: `Before undoing: ${String(v.summary).split("\n")[0]}`, payload: { v: 1, days: current }, source: "restore", created_by: actor.userId });
        text = `Put back ${r.restored} day${r.restored === 1 ? "" : "s"}${r.skipped ? ` (${r.skipped} already trained, left as is)` : ""}.`;
        break;
      }
      case "correct_logged_exercise": {
        const row = snap.row;
        if (!row) throw new Error("Nothing to put back.");
        const { error } = await sb.from("pl_exercise_rows").update({ exercise_id: row.exercise_id, exercise_name_override: row.exercise_name_override, time_profile: row.time_profile }).eq("id", row.id);
        if (error) throw new Error(error.message);
        text = "Exercise put back; the logged sets are unchanged.";
        break;
      }
      case "publish_program": {
        const b = snap.block;
        if (!b) throw new Error("Nothing to put back.");
        const { error } = await sb.from("pl_blocks").update({ client_visible: b.client_visible }).eq("id", b.id);
        if (error) throw new Error(error.message);
        text = b.client_visible ? "Visible to the client again." : "Hidden from the client again.";
        break;
      }
      case "move_workout": {
        const s = snap.scheduled;
        if (!s) throw new Error("Nothing to put back.");
        const { moveScheduledWorkout } = await import("@/lib/scheduled-workouts.functions");
        await moveScheduledWorkout({ data: { instanceId: s.id, newDate: s.scheduled_date, time: s.scheduled_time ?? null } });
        text = `Moved back to ${s.scheduled_date}.`;
        break;
      }
      case "set_nutrition_targets": {
        text = await restoreNutrition(sb, v.client_id, snap.nutrition?.target ?? null);
        break;
      }
      case "add_workout": {
        const dayId = snap.created?.day_id;
        if (!dayId) throw new Error("I couldn't find the workout that was added.");
        const program = await import("@/lib/cleo-program.server");
        if ((await program.lockedDays(sb, [dayId])).has(dayId)) throw new Error("That workout has been started or logged, so it stays.");
        await sb.from("pl_scheduled_workouts").delete().eq("source_day_id", dayId);
        const { error } = await sb.from("pl_days").delete().eq("id", dayId);
        if (error) throw new Error(error.message);
        text = "Removed the added workout.";
        break;
      }
      case "build_program":
      case "assign_program_template": {
        const blockId = snap.created?.block_id;
        if (!blockId) throw new Error("I couldn't find the block that was made.");
        const { error } = await sb.from("pl_blocks").update({ client_visible: false }).eq("id", blockId);
        if (error) throw new Error(error.message);
        text = "Hidden from the client. The block is still in their training if you want to delete it.";
        break;
      }
      default:
        throw new Error("That change can't be undone here.");
    }
    await admin.from("pl_program_versions").update({ restore_note: text }).eq("id", versionId);
    return text;
  } catch (e) {
    // Didn't go through: it can be tried again.
    await admin.from("pl_program_versions").update({ restored_at: null, restored_by: null }).eq("id", versionId);
    throw e;
  }
}

const TARGET_FIELDS = ["phase", "goal", "structure", "admin_notes", "client_notes", "water", "status", "visible_to_client", "custom_goal", "custom_phase"] as const;

async function restoreNutrition(sb: Db, clientId: string, before: any | null): Promise<string> {
  const program = await import("@/lib/cleo-program.server");
  const current = await program.currentTargets(sb, clientId);
  if (!before) {
    // There were none before: hide the ones that were set up.
    if (!current) return "Nothing to put back.";
    const { error } = await sb.from("nutrition_targets").update({ visible_to_client: false }).eq("id", current.id);
    if (error) throw new Error(error.message);
    return "Hidden the new targets from the client.";
  }
  const patch: Record<string, unknown> = { last_updated_at: new Date().toISOString() };
  for (const k of TARGET_FIELDS) if (k in before) patch[k] = before[k];
  const { error } = await sb.from("nutrition_targets").update(patch).eq("id", before.id);
  if (error) throw new Error(error.message);
  const oldDays = ((before.nutrition_target_days ?? []) as any[]).map(({ id: _i, created_at: _c, updated_at: _u, ...d }) => ({ ...d, target_id: before.id }));
  const nowDays = ((current?.id === before.id ? current.nutrition_target_days : []) ?? []) as any[];
  await sb.from("nutrition_target_days").delete().eq("target_id", before.id);
  if (oldDays.length) {
    const { error: dErr } = await sb.from("nutrition_target_days").insert(oldDays);
    if (dErr) {
      if (nowDays.length) await sb.from("nutrition_target_days").insert(nowDays.map(({ id: _i, created_at: _c, updated_at: _u, ...d }) => d));
      throw new Error(dErr.message);
    }
  }
  return "Nutrition targets put back.";
}
