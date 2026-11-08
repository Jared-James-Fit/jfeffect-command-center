/**
 * Applying an Edit with AI proposal, and undoing one. Server-only.
 *
 * Apply re-reads the program with the coach's own session, checks that every
 * ref the kept changes use still names the record the coach previewed and
 * that no workout they touch changed since, rebuilds the plan from the
 * program as it is now, and hands it to program_ai_apply (one transaction
 * that checks access, locks, ownership and the library again, writes a
 * restore point, then the rows). New training days and re-dating go through
 * the app's own scheduler afterwards (writeCommittedDays +
 * realignClientToCommittedDays), recorded on the restore point so Undo puts
 * the dates back. Finally it reads the records back to confirm they say what
 * was approved.
 */
import { buildPlan, refIndex, resolveChanges, templatePayloadFrom, type EngineCtx } from "./engine";
import { catalogFrom, loadClientSnapshot, loadTemplateSnapshot, toFullDays, toShortDays } from "./load.server";
import type { EditChange } from "./ops";
import type { CatalogExercise, ProgramSnapshot } from "./types";

type Db = any;
export type Actor = { supabase: Db; userId: string };

export type ApplyOutcome = {
  versionId: string;
  counts: Record<string, number>;
  schedule: { trainingDays: string[] | null; moved: number; keptPinned: number; unplaced: number; error?: string } | null;
  verified: { ok: boolean; checked: number; problems: string[] };
  templateId?: string;
  newTemplate?: boolean;
};

const STALE = "This program changed since the proposal was made (it was edited, trained or re-dated). Ask again so the proposal starts from the program as it is now.";

function friendly(e: any): Error {
  const msg = String(e?.message ?? e);
  if (e?.hint === "program_ai_stale" || /changed since/.test(msg)) return new Error(STALE);
  if (e?.hint === "program_ai_locked") return new Error(msg);
  if (e?.hint === "program_ai_applied") return new Error("This proposal was already applied.");
  return new Error(msg);
}

async function admin(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

/** The exercises the proposal named (by its codes), plus everything in the program now. */
export function applyCtx(result: any, program: CatalogExercise[]): EngineCtx {
  const codes = Object.values((result?.exercises ?? {}) as Record<string, CatalogExercise>);
  const names = new Map(Object.entries((result?.names ?? {}) as Record<string, CatalogExercise>));
  const all = [...program, ...codes, ...names.values()];
  return { catalog: new Map(codes.map((e) => [e.code, e])), byId: new Map(all.map((e) => [e.id, e])), names };
}

/** Every ref the kept changes use must still name the record the coach saw. */
export function refsStillMatch(snap: ProgramSnapshot, changes: EditChange[], saw: Record<string, string>): boolean {
  const now = refIndex(snap);
  for (const c of changes)
    for (const op of c.ops as any[])
      for (const ref of [...(op.rows ?? []), ...(op.days ?? []), ...(op.weeks ?? [])]) {
        const was = saw[String(ref)];
        if (!was || now.get(String(ref))?.id !== was) return false;
      }
  return true;
}

async function loadEdit(sb: Db, editId: string, changeIds: string[]) {
  const { data: edit, error } = await sb.from("program_ai_edits").select("*").eq("id", editId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!edit) throw new Error("That proposal wasn't found.");
  if (edit.status === "applied") throw new Error("This proposal was already applied.");
  if (edit.status !== "ready") throw new Error("This proposal isn't ready to apply.");
  const proposal = (edit.result?.proposal ?? []) as EditChange[];
  const accepted = proposal.filter((c) => changeIds.includes(c.id));
  if (!accepted.length) throw new Error("Pick at least one change to apply.");
  return { edit, accepted };
}

export async function applyEdit(actor: Actor, editId: string, changeIds: string[], opts: { newTemplateName?: string | null } = {}): Promise<ApplyOutcome> {
  const { edit, accepted } = await loadEdit(actor.supabase, editId, changeIds);
  return edit.target_kind === "template" ? applyTemplate(actor, edit, accepted, opts.newTemplateName ?? null) : applyClient(actor, edit, accepted);
}

async function applyClient(actor: Actor, edit: any, accepted: EditChange[]): Promise<ApplyOutcome> {
  const sb = actor.supabase;
  const { snap, meta, client } = await loadClientSnapshot(sb, edit.client_id, { focusBlockId: edit.focus_block_id });
  if (!refsStillMatch(snap, accepted, edit.result?.refs ?? {})) throw new Error(STALE);
  const ctx = applyCtx(edit.result, catalogFrom([...meta.values()], new Set(meta.keys())));
  const now = resolveChanges(snap, accepted, ctx);
  const bad = now.filter((c) => !c.ok);
  if (bad.length) throw new Error(`These can't be applied now: ${bad.map((c) => `"${c.title}" (${c.issues.find((i) => i.level === "error")?.text ?? "invalid"})`).join("; ")}`);
  const built = buildPlan(snap, accepted, ctx);
  if (built.issues.some((i) => i.level === "error")) throw new Error(built.issues.find((i) => i.level === "error")!.text);
  // the workouts as the coach previewed them: any change since → ask again
  const saw = (edit.result?.bases ?? {}) as Record<string, any>;
  for (const b of built.plan.day_bases) {
    const was = saw[b.id];
    if (!was || was.day !== b.day || was.rows !== b.rows || was.rows_max !== b.rows_max) throw new Error(STALE);
  }
  const { data, error } = await sb.rpc("program_ai_apply", { p_edit_id: edit.id, p_change_ids: accepted.map((c) => c.id), p_plan: built.plan });
  if (error) throw friendly(error);
  const out = data as any;
  const versionId = out.version_id as string;

  // dates: new training days and/or re-dating, and any workout added or removed
  let schedule: ApplyOutcome["schedule"] = null;
  const structural = built.plan.day_inserts.length > 0 || built.plan.day_deletes.length > 0;
  if (built.schedule || structural) {
    const trainingDays = built.schedule?.trainingDays?.length ? built.schedule.trainingDays : null;
    schedule = { trainingDays, moved: 0, keptPinned: 0, unplaced: 0 };
    try {
      const { data: isAdmin } = await sb.rpc("has_role", { _user_id: actor.userId, _role: "admin" });
      const role = isAdmin ? "admin" : "coach";
      const { writeCommittedDays, realignClientToCommittedDays } = await import("@/lib/schedule-bulk.functions");
      const before = (client.committed_training_days ?? []) as string[];
      if (trainingDays) await writeCommittedDays({ clientId: edit.client_id, userId: actor.userId, role: role as any, days: toFullDays(trainingDays) as any });
      const r = await realignClientToCommittedDays({ clientId: edit.client_id, userId: actor.userId, role: role as any, includePinned: false });
      schedule = { trainingDays, moved: r.applied ?? 0, keptPinned: r.pendingPinned ?? 0, unplaced: r.unplaced ?? 0 };
      const db = await admin();
      const { data: v } = await db.from("pl_program_versions").select("payload").eq("id", versionId).maybeSingle();
      await db
        .from("pl_program_versions")
        .update({ payload: { ...(v?.payload ?? {}), schedule: { committed_before: before, committed_after: trainingDays ? toFullDays(trainingDays) : before, batch_id: r.batchId ?? null } } })
        .eq("id", versionId);
    } catch (e: any) {
      schedule = { ...(schedule ?? { trainingDays: null, moved: 0, keptPinned: 0, unplaced: 0 }), error: `The program changes are saved, but the dates didn't move: ${String(e?.message ?? e).slice(0, 200)}` };
    }
  }

  // read it back
  const verified = await verifyClient(sb, built.plan);
  return { versionId, counts: out, schedule, verified };
}

async function verifyClient(sb: Db, plan: ReturnType<typeof buildPlan>["plan"]): Promise<ApplyOutcome["verified"]> {
  const problems: string[] = [];
  const ids = [...plan.row_updates.map((u) => u.id), ...plan.row_inserts.map((r) => String(r.id))];
  const rows = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await sb.from("pl_exercise_rows").select("*").in("id", ids.slice(i, i + 150));
    if (error) return { ok: false, checked: 0, problems: [`Couldn't read the program back: ${error.message}`] };
    for (const r of data ?? []) rows.set(r.id, r);
  }
  const same = (a: unknown, b: unknown) => (a == null && b == null) || String(a) === String(b) || Number(a) === Number(b);
  for (const u of plan.row_updates) {
    const r = rows.get(u.id);
    if (!r) problems.push(`An updated exercise is missing (${u.id}).`);
    else for (const [k, v] of Object.entries(u.patch)) if (!same(r[k], v)) problems.push(`${k} on ${u.id} reads ${r[k]}, expected ${v}.`);
  }
  for (const ins of plan.row_inserts) if (!rows.has(String(ins.id))) problems.push(`An added exercise is missing (${ins.id}).`);
  const gone = plan.row_deletes.map((d) => d.id);
  if (gone.length) {
    const { data } = await sb.from("pl_exercise_rows").select("id").in("id", gone.slice(0, 300));
    if (data?.length) problems.push(`${data.length} removed exercise(s) are still there.`);
  }
  const dayIds = [...plan.day_inserts.map((d) => d.id), ...plan.day_deletes.map((d) => d.id)];
  if (dayIds.length) {
    const { data } = await sb.from("pl_days").select("id").in("id", dayIds.slice(0, 300));
    const have = new Set(((data ?? []) as any[]).map((d) => d.id));
    for (const d of plan.day_inserts) if (!have.has(d.id)) problems.push("An added workout is missing.");
    for (const d of plan.day_deletes) if (have.has(d.id)) problems.push("A removed workout is still there.");
  }
  const checked = plan.row_updates.length + plan.row_inserts.length + plan.row_deletes.length + plan.day_inserts.length + plan.day_deletes.length + plan.day_updates.length;
  return { ok: !problems.length, checked, problems: problems.slice(0, 10) };
}

async function applyTemplate(actor: Actor, edit: any, accepted: EditChange[], newName: string | null): Promise<ApplyOutcome> {
  const sb = actor.supabase;
  const { snap, v2, meta } = await loadTemplateSnapshot(sb, edit.template_id);
  if ((edit.result?.revision ?? null) !== (snap.revision ?? null) || !refsStillMatch(snap, accepted, edit.result?.refs ?? {})) throw new Error(STALE);
  const ctx = applyCtx(edit.result, catalogFrom([...meta.values()], new Set(meta.keys())));
  const now = resolveChanges(snap, accepted, ctx);
  const bad = now.filter((c) => !c.ok);
  if (bad.length) throw new Error(`These can't be applied now: ${bad.map((c) => `"${c.title}"`).join("; ")}`);
  const built = buildPlan(snap, accepted, ctx);
  const { payload, meta: tplMeta } = templatePayloadFrom(v2, snap, built.work);
  const { serializeTemplatePayload } = await import("@/lib/pl-template-blocks");
  const stored = serializeTemplatePayload(payload);
  const { data, error } = await sb.rpc("program_ai_apply_template", {
    p_edit_id: edit.id,
    p_change_ids: accepted.map((c) => c.id),
    p_payload: stored,
    p_base_revision: snap.revision ?? 0,
    p_meta: tplMeta,
    p_new_name: newName?.trim() || null,
  });
  if (error) throw friendly(error);
  const out = data as any;
  // read it back
  const { data: t } = await sb.from("pl_templates").select("payload").eq("id", out.template_id).maybeSingle();
  const problems: string[] = [];
  if (!t) problems.push("Couldn't read the template back.");
  else if (stable(t.payload?.blocks ?? null) !== stable(stored.blocks)) problems.push("The saved template doesn't match what was approved.");
  return {
    versionId: out.version_id,
    counts: { workouts: built.plan.day_bases.length + built.plan.day_inserts.length },
    schedule: null,
    verified: { ok: !problems.length, checked: 1, problems },
    templateId: out.template_id,
    newTemplate: !!out.new_template,
  };
}

/** JSON with sorted keys (the database reorders an object's keys). */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).filter((k) => (v as any)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable((v as any)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

/** Undo an applied proposal (or a previous undo). Dates go back with it. */
export async function undoVersion(actor: Actor, versionId: string): Promise<{ note: string; redoVersionId: string | null; scheduleNote?: string | null }> {
  const sb = actor.supabase;
  const { data, error } = await sb.rpc("program_ai_restore", { p_version_id: versionId });
  if (error) throw friendly(error);
  const out = data as any;
  const db = await admin();
  const { data: v } = await db.from("pl_program_versions").select("restore_note, client_id, payload").eq("id", versionId).maybeSingle();
  let scheduleNote: string | null = null;
  const sched = v?.payload?.schedule;
  if (v?.client_id && sched) {
    try {
      const { data: isAdmin } = await sb.rpc("has_role", { _user_id: actor.userId, _role: "admin" });
      const role = isAdmin ? "admin" : "coach";
      const { writeCommittedDays } = await import("@/lib/schedule-bulk.functions");
      if (JSON.stringify(toShortDays(sched.committed_before)) !== JSON.stringify(toShortDays(sched.committed_after))) {
        await writeCommittedDays({ clientId: v.client_id, userId: actor.userId, role: role as any, days: sched.committed_before });
      }
      let moved = 0;
      if (sched.batch_id) moved = await revertScheduleBatch(db, sched.batch_id);
      scheduleNote = moved ? `${moved} workout date${moved === 1 ? "" : "s"} put back.` : null;
    } catch (e: any) {
      scheduleNote = `The program is back, but the dates didn't move back: ${String(e?.message ?? e).slice(0, 160)}`;
    }
  }
  return { note: out.note ?? v?.restore_note ?? "Undone.", redoVersionId: out.redo_version_id ?? null, scheduleNote };
}

/** Put every workout a re-dating moved back on its old date (never one trained since). */
async function revertScheduleBatch(db: Db, batchId: string): Promise<number> {
  const { data: rows } = await db.from("pl_schedule_audit").select("day_id, previous_date, previous_source").eq("batch_id", batchId);
  let moved = 0;
  for (const r of (rows ?? []) as any[]) {
    if (!r.previous_date) continue;
    const { data: done } = await db.from("pl_day_completions").select("id, completed_at, started_at, in_progress_at").eq("day_id", r.day_id);
    if ((done ?? []).some((c: any) => c.completed_at || c.started_at || c.in_progress_at)) continue;
    const { error } = await db.from("pl_days").update({ scheduled_date: r.previous_date, schedule_source: r.previous_source ?? "auto" }).eq("id", r.day_id);
    if (error) continue;
    await db.from("pl_scheduled_workouts").update({ scheduled_date: r.previous_date }).eq("source_day_id", r.day_id);
    moved++;
  }
  return moved;
}
