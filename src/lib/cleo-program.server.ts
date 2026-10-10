/**
 * Cleo and training programs: the exercise library, program templates and a
 * block's full layout (lookups), plus what her program cards say and do.
 * Server-only.
 *
 * Rules every program change follows:
 * - Exercises come from the library only (resolve_exercise_id + search). Cleo
 *   never creates an exercise, so there are no near-duplicates.
 * - A day the client has started or logged is never edited: deleting a row
 *   deletes its logged sets (pl_row_results cascades), and history stays as
 *   it was trained.
 * - Writes use the person's own session, in the same row shapes as the
 *   program editor (pl-programs.ts), so the editor shows them as its own.
 * - New days get dates the way template assignment does: the client's
 *   committed training days (realignClientToCommittedDays), or the weekdays
 *   the coach named.
 */
import { tool } from "ai";
import { z } from "zod";
import { rpcRead } from "@/lib/permissions.server";
import { filterPrimaryProgramBlocks } from "@/lib/at-home-backup";
import { rxText, rxToRow, trainingDayDates, weekdayLabel, type Rx, type Weekday } from "@/lib/cleo-program";

type Db = any;

function rows<T = any>(res: { data: T[] | null; error: any }, what: string): T[] {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data ?? [];
}

function clip(text: string, max = 16_000): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… (cut off; ask for fewer weeks)`;
}

function safe<A>(name: string, fn: (args: A) => Promise<string>) {
  return async (args: A) => {
    try {
      return clip(await fn(args));
    } catch (e: any) {
      return `Couldn't read ${name}: ${e?.message ?? "error"}. Tell the person you couldn't load it; don't guess.`;
    }
  };
}

function clientLabel(c: any): string {
  return (c?.full_name ?? "").trim() || `${c?.preferred_name || c?.first_name || ""} ${c?.last_name ?? ""}`.trim() || c?.email || "the client";
}

// ---------------------------------------------------------------------------
// Lookups

export function cleoProgramTools({ db, today }: { db: Db; today: string }) {
  return {
    exercise_library: tool({
      description:
        "Find exercises in the app's exercise library by name. Program changes can only use exercises from here (by id). If nothing fits, say so and suggest the closest ones; never make one up.",
      inputSchema: z.object({ query: z.string().trim().min(2).max(60) }),
      execute: safe("the exercise library", async ({ query }) => {
        const [exact, byName, byAlias] = await Promise.all([
          rpcRead(db, "resolve_exercise_id", { _name: query }),
          db.from("exercises").select("id, name, primary_muscle_group, muscle_group, category, video_url").eq("archived", false).ilike("name", `%${query.replace(/[%_]/g, "")}%`).limit(12),
          db.from("exercise_aliases").select("exercise_id, alias_name").ilike("alias_name", `%${query.replace(/[%_]/g, "")}%`).limit(12),
        ]);
        const ids = new Set<string>();
        if (exact?.data) ids.add(exact.data);
        for (const r of rows<any>(byName as any, "exercises")) ids.add(r.id);
        for (const r of rows<any>(byAlias as any, "aliases")) if (r.exercise_id) ids.add(r.exercise_id);
        // Word search as a fallback ("hb squat" → every word in the name).
        if (ids.size < 3) {
          const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1).slice(0, 3);
          if (words.length > 1) {
            let q = db.from("exercises").select("id").eq("archived", false);
            for (const w of words) q = q.ilike("name", `%${w.replace(/[%_]/g, "")}%`);
            for (const r of rows<any>(await q.limit(12), "exercises")) ids.add(r.id);
          }
        }
        if (!ids.size) return `No library exercise matches "${query}". Try another name (e.g. "back squat", "RDL", "lat pulldown").`;
        const list = rows<any>(
          await db.from("exercises").select("id, name, primary_muscle_group, muscle_group, category, video_url").in("id", [...ids].slice(0, 15)),
          "exercises",
        );
        list.sort((a, b) => (a.id === exact?.data ? -1 : b.id === exact?.data ? 1 : a.name.length - b.name.length));
        return [
          `Library matches for "${query}" (use the id):`,
          ...list.map((e) => `- ${e.name} | id ${e.id} | ${e.primary_muscle_group ?? e.muscle_group ?? "?"}${e.category ? ` | ${e.category}` : ""}${e.video_url ? " | has demo video" : ""}${e.id === exact?.data ? " | exact match" : ""}`),
        ].join("\n");
      }),
    }),

    program_templates: tool({
      description: "Program templates in the library (name, type, style, weeks, days per week) with their ids, for assigning a client a program.",
      inputSchema: z.object({ query: z.string().trim().max(60).optional() }),
      execute: safe("program templates", async ({ query }) => {
        let q = db.from("pl_templates").select("*").eq("archived", false).order("updated_at", { ascending: false }).limit(40);
        if (query) q = q.ilike("name", `%${query.replace(/[%_]/g, "")}%`);
        const list = rows<any>(await q, "templates");
        if (!list.length) return query ? `No template matches "${query}".` : "There are no program templates.";
        return [
          "Program templates:",
          ...list.map((t) => `- ${t.name} | id ${t.id} | ${t.template_type ?? "?"} | ${t.training_style ?? "?"} | ${t.weeks ?? "?"} weeks | ${t.days_per_week ?? "?"} days/week${t.status ? ` | ${t.status}` : ""}`),
        ].join("\n");
      }),
    }),

    program_detail: tool({
      description:
        "A block's full layout: weeks, days (day ids, dates, done or not) and every exercise row (row ids, exercise, sets x reps, RPE/RIR, load or %, rest, notes). Use before editing. Pass client_id for their current block, or block_id.",
      inputSchema: z.object({
        client_id: z.string().uuid().optional(),
        block_id: z.string().uuid().optional(),
        weeks: z.array(z.number().int().min(1).max(52)).max(8).optional().describe("Only these week numbers. Default: the current week and the next one."),
      }),
      execute: safe("the program", async ({ client_id, block_id, weeks }) => {
        let block: any = null;
        if (block_id) {
          block = (await db.from("pl_blocks").select("*").eq("id", block_id).maybeSingle()).data;
        } else if (client_id) {
          const all = filterPrimaryProgramBlocks(rows<any>(await db.from("pl_blocks").select("*").eq("client_id", client_id).eq("archived", false).order("start_date", { ascending: false }), "blocks"));
          block =
            all.find((b) => b.status === "Active" && (!b.start_date || b.start_date <= today) && (!b.end_date || b.end_date >= today)) ??
            all.find((b) => b.status === "Active") ??
            all[0] ??
            null;
        }
        if (!block) return "No program block found. Use training_program to list their blocks, or build one.";
        const wk = rows<any>(await db.from("pl_weeks").select("*").eq("block_id", block.id).is("deleted_at", null).order("week_index"), "weeks").filter((w) => !w.archived);
        const current = wk.find((w) => w.start_date && w.end_date && w.start_date <= today && w.end_date >= today)?.week_index ?? wk[0]?.week_index ?? 1;
        const pick = new Set(weeks?.length ? weeks : [current, current + 1]);
        const shown = wk.filter((w) => pick.has(w.week_index));
        const days = shown.length
          ? rows<any>(await db.from("pl_days").select("*").in("week_id", shown.map((w) => w.id)).eq("archived", false).is("deleted_at", null).order("day_index"), "days")
          : [];
        const dayIds = days.map((d) => d.id);
        const [rowRes, compRes] = await Promise.all([
          dayIds.length ? db.from("pl_exercise_rows").select("*, exercises(name)").in("day_id", dayIds).order("sort_order") : Promise.resolve({ data: [], error: null }),
          dayIds.length ? db.from("pl_day_completions").select("day_id, completed_at, started_at, in_progress_at").in("day_id", dayIds) : Promise.resolve({ data: [], error: null }),
        ]);
        const rws = rows<any>(rowRes as any, "rows");
        const touched = new Map<string, string>();
        for (const c of rows<any>(compRes as any, "completions")) {
          if (c.completed_at) touched.set(c.day_id, "DONE");
          else if ((c.started_at || c.in_progress_at) && !touched.has(c.day_id)) touched.set(c.day_id, "STARTED");
        }
        const lines = [
          `${block.name} | block id ${block.id} | ${block.status} | ${block.client_visible ? "published (client sees it)" : "HIDDEN from client"} | ${block.start_date ?? "?"} to ${block.end_date ?? "?"} | ${wk.length} weeks (current week ${current})`,
        ];
        if (block.coach_notes) lines.push(`Coach notes: ${String(block.coach_notes).slice(0, 300)}`);
        for (const w of shown) {
          lines.push(`Week ${w.week_index}${w.start_date ? ` (${w.start_date} to ${w.end_date ?? "?"})` : ""}${w.phase ? ` | ${w.phase}` : ""}:`);
          for (const d of days.filter((x) => x.week_id === w.id)) {
            lines.push(`  Day ${d.day_index}${d.title ? ` "${d.title}"` : ""}${d.subtitle ? ` (${d.subtitle})` : ""} | day id ${d.id}${d.scheduled_date ? ` | ${d.scheduled_date}` : ""}${touched.has(d.id) ? ` | ${touched.get(d.id)} (locked)` : ""}${d.is_custom ? " | custom (not linked)" : ""}`);
            for (const r of rws.filter((x) => x.day_id === d.id)) {
              lines.push(`    - ${r.exercises?.name ?? r.exercise_name_override ?? "Exercise"} | row id ${r.id} | ${rxText(r) || "no prescription yet"}`);
            }
          }
        }
        if (!shown.length) lines.push("No weeks match.");
        return lines.join("\n");
      }),
    }),
  };
}

// ---------------------------------------------------------------------------
// Shared checks

async function exerciseNames(db: Db, ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const list = rows<any>(await db.from("exercises").select("id, name, archived").in("id", uniq), "exercises");
  const map = new Map(list.filter((e) => !e.archived).map((e) => [e.id, e.name as string]));
  const missing = uniq.filter((id) => !map.has(id));
  if (missing.length) throw new Error("One of those exercises isn't in the library. Look it up with exercise_library and use its id.");
  return map;
}

async function client(db: Db, id: string) {
  const { data, error } = await db.from("clients").select("id, full_name, preferred_name, first_name, last_name, email, committed_training_days, preferred_weight_unit").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("I couldn't find that client.");
  return data;
}

/** Days the client has started or logged (never edited), among `dayIds`. */
async function lockedDays(db: Db, dayIds: string[]): Promise<Set<string>> {
  if (!dayIds.length) return new Set();
  const [comps, rws] = await Promise.all([
    db.from("pl_day_completions").select("day_id, completed_at, started_at, in_progress_at").in("day_id", dayIds),
    db.from("pl_exercise_rows").select("id, day_id").in("day_id", dayIds),
  ]);
  const locked = new Set<string>();
  for (const c of rows<any>(comps as any, "completions")) if (c.completed_at || c.started_at || c.in_progress_at) locked.add(c.day_id);
  const rowList = rows<any>(rws as any, "rows");
  if (rowList.length) {
    const logged = rows<any>(await db.from("pl_row_results").select("row_id").in("row_id", rowList.map((r) => r.id).slice(0, 500)).limit(1000), "logged sets");
    const byRow = new Map(rowList.map((r) => [r.id, r.day_id]));
    for (const l of logged) locked.add(byRow.get(l.row_id));
  }
  return locked;
}

/** The day and, for scope "future", the same day in later weeks that aren't custom or locked. */
async function targetDays(db: Db, dayId: string, scope: "this" | "future") {
  const { data: day } = await db.from("pl_days").select("id, week_id, day_index, title, is_custom").eq("id", dayId).maybeSingle();
  if (!day) throw new Error("I couldn't find that program day.");
  const { data: week } = await db.from("pl_weeks").select("id, block_id, week_index").eq("id", day.week_id).maybeSingle();
  if (!week) throw new Error("I couldn't find that program week.");
  const { data: block } = await db.from("pl_blocks").select("id, name, client_id").eq("id", week.block_id).maybeSingle();
  let days = [{ ...day, week_index: week.week_index }];
  if (scope === "future") {
    const later = rows<any>(await db.from("pl_weeks").select("id, week_index").eq("block_id", week.block_id).gt("week_index", week.week_index).is("deleted_at", null), "weeks");
    if (later.length) {
      const idx = new Map(later.map((w) => [w.id, w.week_index]));
      const more = rows<any>(await db.from("pl_days").select("id, week_id, day_index, title, is_custom").in("week_id", later.map((w) => w.id)).eq("day_index", day.day_index).eq("archived", false).is("deleted_at", null), "days");
      days = days.concat(more.filter((d) => !d.is_custom).map((d) => ({ ...d, week_index: idx.get(d.week_id) })));
    }
  }
  const locked = await lockedDays(db, days.map((d) => d.id));
  return { block, week, origin: day, days: days.filter((d) => !locked.has(d.id)).sort((a, b) => a.week_index - b.week_index), lockedCount: days.filter((d) => locked.has(d.id)).length, originLocked: locked.has(day.id) };
}

// ---------------------------------------------------------------------------
// Cards

const PROGRAM_KINDS = ["assign_program_template", "build_program", "edit_program_day", "add_workout", "publish_program", "move_workout", "correct_logged_exercise", "set_nutrition_targets"] as const;
export type ProgramKind = (typeof PROGRAM_KINDS)[number];
export function isProgramKind(k: string): k is ProgramKind {
  return (PROGRAM_KINDS as readonly string[]).includes(k);
}

function longDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

export async function describeProgramAction(db: Db, kind: ProgramKind, p: any, today: string): Promise<string> {
  switch (kind) {
    case "assign_program_template": {
      const c = await client(db, p.client_id);
      const { data: t } = await db.from("pl_templates").select("name, weeks, days_per_week, archived").eq("id", p.template_id).maybeSingle();
      if (!t || t.archived) throw new Error("I couldn't find that template.");
      const days = (c.committed_training_days ?? []) as string[];
      return [
        `Put ${clientLabel(c)} on "${p.name ?? t.name}" (${t.weeks ?? "?"} weeks, ${t.days_per_week ?? "?"} days/week) starting ${longDate(p.start_date)}.`,
        days.length ? `Workouts land on their training days (${days.join(", ")}).` : `They have no training days set, so the workouts won't have dates until their schedule is set.`,
        p.publish ? `${clientLabel(c)} sees it right away.` : "Hidden from them until you publish it.",
      ].join("\n");
    }
    case "build_program": {
      const c = await client(db, p.client_id);
      const names = await exerciseNames(db, p.days.flatMap((d: any) => d.exercises.map((e: any) => e.exercise_id)));
      const committed = (c.committed_training_days ?? []) as string[];
      const when = p.training_days
        ? (p.training_days as Weekday[]).map(weekdayLabel).join("/")
        : committed.length
        ? `their training days (${committed.join(", ")})`
        : "no dates yet (they have no training days set)";
      const lines = [
        `Build "${p.name}" for ${clientLabel(c)}: ${p.weeks} week${p.weeks === 1 ? "" : "s"} from ${longDate(p.start_date)}, ${p.days.length} day${p.days.length === 1 ? "" : "s"} a week on ${when}.`,
      ];
      p.days.forEach((d: any, i: number) => {
        lines.push(`Day ${i + 1}: ${d.title}${d.focus ? ` (${d.focus})` : ""}`);
        for (const e of d.exercises) {
          const prog = (e.weeks ?? []).map((w: any) => `wk${w.week} ${rxText(w)}`).join("; ");
          lines.push(`- ${names.get(e.exercise_id)}: ${rxText(e) || "no prescription"}${prog ? ` | ${prog}` : ""}`);
        }
      });
      lines.push(p.publish ? `${clientLabel(c)} sees it right away.` : "Hidden from them until you publish it.");
      return lines.join("\n");
    }
    case "edit_program_day": {
      const t = await targetDays(db, p.day_id, p.scope);
      if (t.originLocked) throw new Error("That day has already been started or logged, so its plan stays as trained. If they did a different exercise than planned, use propose_correct_logged_exercise on that row instead (their logged sets stay).");
      const rowIds = p.changes.map((c: any) => c.row_id).filter(Boolean);
      const rowList = rowIds.length ? rows<any>(await db.from("pl_exercise_rows").select("id, day_id, exercises(name), exercise_name_override").in("id", rowIds), "rows") : [];
      const rowName = new Map(rowList.map((r) => [r.id, r.exercises?.name ?? r.exercise_name_override ?? "exercise"]));
      for (const r of rowList) if (r.day_id !== p.day_id) throw new Error("Every row has to be on the day being edited.");
      if (rowList.length !== new Set(rowIds).size) throw new Error("One of those rows isn't on that day anymore. Look at program_detail again.");
      const names = await exerciseNames(db, p.changes.map((c: any) => c.exercise_id).filter(Boolean));
      const { data: c } = t.block?.client_id ? await db.from("clients").select("full_name, preferred_name, first_name, last_name, email").eq("id", t.block.client_id).maybeSingle() : { data: null };
      const weeksTouched = t.days.map((d: any) => d.week_index);
      const lines = [
        `${clientLabel(c)}'s ${t.block?.name ?? "program"}, week ${t.days[0]?.week_index ?? "?"} day ${t.origin.day_index}${t.origin.title ? ` "${t.origin.title}"` : ""}${p.scope === "future" && weeksTouched.length > 1 ? `, and the same day in weeks ${weeksTouched.slice(1).join(", ")}` : ""}:`,
      ];
      for (const ch of p.changes) {
        if (ch.op === "update") lines.push(`- ${rowName.get(ch.row_id)}: ${rxText(ch)}`);
        if (ch.op === "swap") lines.push(`- Swap ${rowName.get(ch.row_id)} for ${names.get(ch.exercise_id)}${rxText(ch) ? `: ${rxText(ch)}` : ""}`);
        if (ch.op === "add") lines.push(`- Add ${names.get(ch.exercise_id)}: ${rxText(ch) || "no prescription"}`);
        if (ch.op === "remove") lines.push(`- Remove ${rowName.get(ch.row_id)}`);
      }
      if (t.lockedCount) lines.push(`${t.lockedCount} started or logged day${t.lockedCount === 1 ? "" : "s"} left as trained.`);
      return lines.join("\n");
    }
    case "add_workout": {
      const c = await client(db, p.client_id);
      const names = await exerciseNames(db, p.exercises.map((e: any) => e.exercise_id));
      const block = await blockFor(db, p.client_id, p.block_id, today);
      return [
        `Add "${p.title}"${p.focus ? ` (${p.focus})` : ""} to ${clientLabel(c)}'s ${block.name} on ${longDate(p.date)}:`,
        ...p.exercises.map((e: any) => `- ${names.get(e.exercise_id)}: ${rxText(e) || "no prescription"}`),
        block.client_visible ? `${clientLabel(c)} sees it on their calendar.` : `This block is hidden from ${clientLabel(c)} until it's published.`,
      ].join("\n");
    }
    case "publish_program": {
      const { data: b } = await db.from("pl_blocks").select("name, client_id, client_visible").eq("id", p.block_id).maybeSingle();
      if (!b) throw new Error("I couldn't find that block.");
      const c = await client(db, b.client_id);
      if (!!b.client_visible === !!p.visible) throw new Error(`"${b.name}" is already ${p.visible ? "published" : "hidden"}.`);
      return p.visible ? `Publish "${b.name}" so ${clientLabel(c)} can see and train it.` : `Hide "${b.name}" from ${clientLabel(c)}.`;
    }
    case "correct_logged_exercise": {
      const { data: r } = await db.from("pl_exercise_rows").select("id, day_id, exercise_id, exercise_name_override, exercises(name)").eq("id", p.row_id).maybeSingle();
      if (!r) throw new Error("I couldn't find that row.");
      if (r.exercise_id === p.exercise_id) throw new Error("That row is already that exercise.");
      const names = await exerciseNames(db, [p.exercise_id]);
      const [{ data: sets }, { data: day }] = await Promise.all([
        db.from("pl_row_results").select("client_id, set_index, entered_value, entered_unit, actual_reps, actual_rpe, completed_at").eq("row_id", r.id).order("set_index"),
        db.from("pl_days").select("title, day_index").eq("id", r.day_id).maybeSingle(),
      ]);
      const logged = (sets ?? []) as any[];
      const c = logged[0]?.client_id ? await client(db, logged[0].client_id) : null;
      const when = logged[0]?.completed_at ? ` on ${longDate(String(logged[0].completed_at).slice(0, 10))}` : "";
      return [
        `Fix ${c ? `${clientLabel(c)}'s ` : ""}${day?.title ? `"${day.title}"` : `Day ${day?.day_index ?? "?"}`}${when}: change ${r.exercises?.name ?? r.exercise_name_override ?? "the exercise"} to ${names.get(p.exercise_id)}.`,
        logged.length
          ? `Their ${logged.length} logged set${logged.length === 1 ? "" : "s"} stay exactly as entered: ${logged.map((x) => `${x.entered_value ?? "?"} ${x.entered_unit ?? ""} x ${x.actual_reps ?? "?"}${x.actual_rpe ? ` @${x.actual_rpe}` : ""}`.replace(/\s+/g, " ")).join(", ")}.`
          : "Nothing is logged on it yet.",
      ].join("\n");
    }
    case "set_nutrition_targets": {
      const c = await client(db, p.client_id);
      const current = await currentTargets(db, p.client_id);
      const before = new Map(((current?.nutrition_target_days ?? []) as any[]).map((d) => [String(d.day_label).toLowerCase(), d]));
      const macro = (d: any) => `${d.calories} kcal, P ${d.protein} / C ${d.carbs} / F ${d.fats}${d.fibre ? `, fibre ${d.fibre}` : ""}`;
      const lines = [`${current ? "Update" : "Set up"} ${clientLabel(c)}'s nutrition${p.phase ? ` (${p.phase})` : current?.phase ? ` (${current.phase})` : ""}:`];
      for (const d of p.days) {
        const was = before.get(d.day_label.toLowerCase());
        lines.push(`- ${d.day_label}: ${macro(d)}${was ? ` (was ${was.calories ?? "?"} kcal, P ${was.protein ?? "?"} / C ${was.carbs ?? "?"} / F ${was.fats ?? "?"})` : ""}`);
      }
      const dropped = [...before.values()].filter((d) => !p.days.some((x: any) => x.day_label.toLowerCase() === String(d.day_label).toLowerCase()));
      if (dropped.length) lines.push(`Removes: ${dropped.map((d) => d.day_label).join(", ")}.`);
      if (p.client_notes) lines.push(`Note to them: ${p.client_notes}`);
      if (p.coach_notes) lines.push(`Staff note: ${p.coach_notes}`);
      lines.push(current && current.visible_to_client === false ? "Their targets are hidden from them." : `${clientLabel(c)} sees the new targets and gets a heads-up.`);
      return lines.join("\n");
    }
    case "move_workout": {
      const { data: w } = await db.from("pl_scheduled_workouts").select("id, client_id, scheduled_date, source_day_id").eq("id", p.workout_id).maybeSingle();
      if (!w) throw new Error("I couldn't find that scheduled workout.");
      const { data: done } = await db.from("pl_day_completions").select("completed_at").eq("scheduled_workout_id", w.id).not("completed_at", "is", null).limit(1);
      if (done?.length) throw new Error("That workout is already logged, so it stays on the day it was trained.");
      const [{ data: d }, c] = await Promise.all([db.from("pl_days").select("title, day_index").eq("id", w.source_day_id).maybeSingle(), client(db, w.client_id)]);
      return `Move ${clientLabel(c)}'s ${d?.title ? `"${d.title}"` : `Day ${d?.day_index ?? "?"}`} from ${longDate(w.scheduled_date)} to ${longDate(p.date)}.`;
    }
  }
}

/** The nutrition targets the coach edits now: the latest one that isn't archived. */
async function currentTargets(db: Db, clientId: string) {
  const { data } = await db
    .from("nutrition_targets")
    .select("*, nutrition_target_days(*)")
    .eq("client_id", clientId)
    .neq("status", "Archived")
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as any | null;
}

/** The block a one-off workout goes into: the one asked for, else the current one. */
async function blockFor(db: Db, clientId: string, blockId: string | undefined, today: string) {
  if (blockId) {
    const { data } = await db.from("pl_blocks").select("*").eq("id", blockId).eq("client_id", clientId).maybeSingle();
    if (!data) throw new Error("That block isn't this client's.");
    return data;
  }
  const all = filterPrimaryProgramBlocks(rows<any>(await db.from("pl_blocks").select("*").eq("client_id", clientId).eq("archived", false).order("start_date", { ascending: false }), "blocks"));
  const b = all.find((x) => x.status === "Active" && (!x.start_date || x.start_date <= today) && (!x.end_date || x.end_date >= today)) ?? all.find((x) => x.status === "Active");
  if (!b) throw new Error("They don't have a current program block. Build or assign one first.");
  return b;
}

// ---------------------------------------------------------------------------
// Doing it (the person's own session)

async function insertRows(sb: Db, dayId: string, exercises: Array<Rx & { exercise_id: string }>, startAt = 0) {
  if (!exercises.length) return;
  const { data: meta } = await sb.from("exercises").select("id, name, category, muscle_group, exercise_category, is_competition_lift, competition_lift_type").in("id", exercises.map((e) => e.exercise_id));
  const byId = new Map((meta ?? []).map((m: any) => [m.id, m]));
  const { inferTimeProfileFromExercise } = await import("@/lib/pl-programs");
  const { defaultRestSeconds } = await import("@/lib/exercise-metadata");
  const payload = exercises.map((e, i) => {
    const m: any = byId.get(e.exercise_id);
    return {
      day_id: dayId,
      sort_order: startAt + i,
      exercise_id: e.exercise_id,
      time_profile: inferTimeProfileFromExercise(m),
      rest_seconds: defaultRestSeconds(m),
      rest_seconds_override: null,
      ...rxToRow(e),
    };
  });
  const { error } = await sb.from("pl_exercise_rows").insert(payload);
  if (error) throw new Error(error.message);
}

export async function executeProgramAction(actor: { supabase: Db; userId: string }, kind: ProgramKind, p: any, today: string): Promise<string> {
  const sb = actor.supabase;
  switch (kind) {
    case "assign_program_template": {
      const { applyTemplateToClientFn } = await import("@/lib/pl-programs.functions");
      await applyTemplateToClientFn({
        data: { templateId: p.template_id, clientId: p.client_id, placement: { mode: "standalone_block" }, name: p.name ?? null, clientVisible: !!p.publish, startDate: p.start_date },
      });
      return p.publish ? "Program assigned and published." : "Program assigned (hidden until you publish it).";
    }
    case "build_program": {
      await exerciseNames(sb, p.days.flatMap((d: any) => d.exercises.map((e: any) => e.exercise_id)));
      const endDate = new Date(Date.parse(`${p.start_date}T00:00:00Z`) + (p.weeks * 7 - 1) * 86_400_000).toISOString().slice(0, 10);
      const { data: block, error } = await sb
        .from("pl_blocks")
        .insert({ client_id: p.client_id, name: p.name, weeks: p.weeks, start_date: p.start_date, end_date: endDate, status: "Active", client_visible: !!p.publish, coach_notes: p.coach_notes ?? null, created_by: actor.userId })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      try {
        const firstDayIds: string[] = [];
        for (let w = 1; w <= p.weeks; w++) {
          const weekStart = new Date(Date.parse(`${p.start_date}T00:00:00Z`) + (w - 1) * 7 * 86_400_000).toISOString().slice(0, 10);
          const weekEnd = new Date(Date.parse(`${weekStart}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
          const { data: week, error: we } = await sb.from("pl_weeks").insert({ block_id: block.id, week_index: w, start_date: weekStart, end_date: weekEnd }).select("id").single();
          if (we) throw new Error(we.message);
          const dates = p.training_days ? trainingDayDates(p.start_date, w, p.training_days) : [];
          for (let i = 0; i < p.days.length; i++) {
            const d = p.days[i];
            const { data: day, error: de } = await sb
              .from("pl_days")
              .insert({
                week_id: week.id,
                day_index: i + 1,
                title: d.title,
                focus: d.focus ?? null,
                // Later weeks link to week 1's day, as the editor's copy-week does.
                source_day_id: w > 1 ? firstDayIds[i] : null,
                is_custom: false,
                ...(dates[i] ? { scheduled_date: dates[i], schedule_source: "manual" } : {}),
              })
              .select("id")
              .single();
            if (de) throw new Error(de.message);
            if (w === 1) firstDayIds.push(day.id);
            await insertRows(
              sb,
              day.id,
              d.exercises.map((e: any) => ({ ...e, ...((e.weeks ?? []).find((x: any) => x.week === w) ?? {}), weeks: undefined, week: undefined })),
            );
          }
        }
      } catch (e) {
        // Don't leave half a block behind.
        await sb.from("pl_blocks").delete().eq("id", block.id);
        throw e;
      }
      if (!p.training_days) {
        try {
          const { realignClientToCommittedDays } = await import("@/lib/schedule-bulk.functions");
          await realignClientToCommittedDays({ clientId: p.client_id, userId: actor.userId, role: "admin", includePinned: false });
        } catch (e) {
          console.warn("[cleo] realign after build failed", e);
        }
      }
      return p.publish ? "Program built and published." : "Program built (hidden until you publish it).";
    }
    case "edit_program_day": {
      const t = await targetDays(sb, p.day_id, p.scope);
      if (t.originLocked) throw new Error("That day has been started or logged since, so it stays as trained.");
      const { data: originRows } = await sb.from("pl_exercise_rows").select("id, sort_order, exercise_id").eq("day_id", p.day_id).order("sort_order");
      const orderOf = new Map((originRows ?? []).map((r: any) => [r.id, r.sort_order]));
      const exerciseOf = new Map((originRows ?? []).map((r: any) => [r.id, r.exercise_id]));
      const { data: meta } = await sb.from("exercises").select("id, name, category, muscle_group, exercise_category, is_competition_lift, competition_lift_type").in("id", p.changes.map((c: any) => c.exercise_id).filter(Boolean));
      const metaById = new Map((meta ?? []).map((m: any) => [m.id, m]));
      const { inferTimeProfileFromExercise } = await import("@/lib/pl-programs");
      let applied = 0;
      for (const day of t.days) {
        // Linked days line up by sort_order, as the editor's cascade does.
        const { data: dayRows } = await sb.from("pl_exercise_rows").select("id, sort_order, exercise_id").eq("day_id", day.id).order("sort_order");
        const bySort = new Map((dayRows ?? []).map((r: any) => [r.sort_order, r]));
        // Same slot AND same exercise: a later week the coach changed by hand is left alone.
        const target = (originRowId: string) => {
          if (day.id === p.day_id) return originRowId;
          const r: any = bySort.get(orderOf.get(originRowId));
          return r && r.exercise_id === exerciseOf.get(originRowId) ? r.id : undefined;
        };
        for (const ch of p.changes) {
          if (ch.op === "update" || ch.op === "swap") {
            const rowId = target(ch.row_id);
            if (!rowId) continue;
            const patch: Record<string, unknown> = { ...rxToRow(ch) };
            if (ch.op === "swap") {
              patch.exercise_id = ch.exercise_id;
              patch.exercise_name_override = null;
              patch.time_profile = inferTimeProfileFromExercise(metaById.get(ch.exercise_id) as any);
            }
            const { error } = await sb.from("pl_exercise_rows").update(patch).eq("id", rowId);
            if (error) throw new Error(error.message);
            applied++;
          }
        }
        for (const ch of p.changes.filter((c: any) => c.op === "remove")) {
          const rowId = target(ch.row_id);
          if (!rowId) continue;
          const { error } = await sb.from("pl_exercise_rows").delete().eq("id", rowId);
          if (error) throw new Error(error.message);
          applied++;
        }
        const adds = p.changes.filter((c: any) => c.op === "add");
        if (adds.length) {
          const { data: now } = await sb.from("pl_exercise_rows").select("id, sort_order").eq("day_id", day.id).order("sort_order");
          const list = (now ?? []) as any[];
          for (const ch of adds) {
            const pos = Math.min(ch.position ?? list.length, list.length);
            // Make room, then insert at the position (addRowFromExercise's approach).
            for (const r of list) if ((r.sort_order ?? 0) >= pos) await sb.from("pl_exercise_rows").update({ sort_order: (r.sort_order ?? 0) + 1 }).eq("id", r.id);
            await insertRows(sb, day.id, [ch], pos);
            list.splice(pos, 0, { id: "new", sort_order: pos });
            list.forEach((r, i) => (r.sort_order = i));
            applied++;
          }
        }
      }
      return `Updated ${t.days.length} day${t.days.length === 1 ? "" : "s"} (${applied} change${applied === 1 ? "" : "s"}).`;
    }
    case "add_workout": {
      await exerciseNames(sb, p.exercises.map((e: any) => e.exercise_id));
      const block = await blockFor(sb, p.client_id, p.block_id, today);
      const weeks = rows<any>(await sb.from("pl_weeks").select("id, week_index, start_date, end_date").eq("block_id", block.id).is("deleted_at", null).order("week_index"), "weeks");
      if (!weeks.length) throw new Error("That block has no weeks.");
      const week = weeks.find((w) => w.start_date && w.end_date && w.start_date <= p.date && w.end_date >= p.date) ?? weeks[weeks.length - 1];
      const { data: siblings } = await sb.from("pl_days").select("day_index").eq("week_id", week.id);
      const dayIndex = Math.max(0, ...((siblings ?? []) as any[]).map((s) => s.day_index ?? 0)) + 1;
      const { data: day, error } = await sb
        .from("pl_days")
        .insert({ week_id: week.id, day_index: dayIndex, title: p.title, focus: p.focus ?? null, is_custom: true, scheduled_date: p.date, schedule_source: "manual" })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      try {
        await insertRows(sb, day.id, p.exercises);
        const { scheduleWorkouts } = await import("@/lib/scheduled-workouts.functions");
        await scheduleWorkouts({ data: { clientId: p.client_id, sourceDayIds: [day.id], date: p.date } });
      } catch (e) {
        await sb.from("pl_days").delete().eq("id", day.id);
        throw e;
      }
      return "Workout added and scheduled.";
    }
    case "publish_program": {
      const { data: b, error } = await sb.from("pl_blocks").update({ client_visible: !!p.visible }).eq("id", p.block_id).select("prep_id").maybeSingle();
      if (error) throw new Error(error.message);
      if (!b) throw new Error("That block couldn't be changed.");
      // A hidden prep would still hide a published block from the client.
      if (p.visible && b.prep_id) await sb.from("pl_preps").update({ client_visible: true }).eq("id", b.prep_id);
      return p.visible ? "Published." : "Hidden from the client.";
    }
    case "correct_logged_exercise": {
      await exerciseNames(sb, [p.exercise_id]);
      const { inferTimeProfileFromExercise } = await import("@/lib/pl-programs");
      const { data: m } = await sb.from("exercises").select("id, name, category, muscle_group, exercise_category, is_competition_lift, competition_lift_type").eq("id", p.exercise_id).maybeSingle();
      // Only which exercise it was: sets, reps, loads and every logged result stay put.
      const { data, error } = await sb
        .from("pl_exercise_rows")
        .update({ exercise_id: p.exercise_id, exercise_name_override: null, time_profile: inferTimeProfileFromExercise(m as any) })
        .eq("id", p.row_id)
        .select("id");
      if (error) throw new Error(error.message);
      if (!data?.length) throw new Error("That row couldn't be changed.");
      return "Exercise corrected; the logged sets are unchanged.";
    }
    case "set_nutrition_targets": {
      const { PHASE_GOAL } = await import("@/lib/nutrition-cardio");
      const current = await currentTargets(sb, p.client_id);
      const now = new Date().toISOString();
      const structure = p.days.length > 1 ? "Training / Rest Day Split" : "Same Every Day";
      let targetId: string;
      if (current) {
        const patch: Record<string, unknown> = { last_updated_at: now, last_updated_date: today };
        if (p.phase) Object.assign(patch, { phase: p.phase, goal: PHASE_GOAL[p.phase] ?? current.goal });
        if (p.coach_notes !== undefined) patch.admin_notes = p.coach_notes;
        if (p.client_notes !== undefined) patch.client_notes = p.client_notes;
        if (p.water !== undefined) patch.water = p.water;
        const { error } = await sb.from("nutrition_targets").update(patch).eq("id", current.id);
        if (error) throw new Error(error.message);
        targetId = current.id;
      } else {
        const phase = p.phase ?? "Maintenance";
        const { data, error } = await sb
          .from("nutrition_targets")
          .insert({ client_id: p.client_id, phase, goal: PHASE_GOAL[phase] ?? "Maintain bodyweight", structure, start_date: today, status: "Active", visible_to_client: true, admin_notes: p.coach_notes ?? null, client_notes: p.client_notes ?? null, water: p.water ?? null, last_updated_at: now })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        targetId = data.id;
      }
      // Same as the targets dialog: replace the day list.
      const old = ((current?.nutrition_target_days ?? []) as any[]).map(({ id, created_at, updated_at, ...d }) => d);
      await sb.from("nutrition_target_days").delete().eq("target_id", targetId);
      const { error: dErr } = await sb.from("nutrition_target_days").insert(p.days.map((d: any, i: number) => ({ target_id: targetId, sort_order: i, ...d })));
      if (dErr) {
        if (old.length) await sb.from("nutrition_target_days").insert(old);
        throw new Error(dErr.message);
      }
      const visible = current ? current.visible_to_client !== false && (current.status ?? "Active") === "Active" : true;
      if (visible) {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { notifyAppEvent } = await import("@/lib/push/app-events.server");
          await notifyAppEvent(supabaseAdmin as any, "nutrition_targets_updated", { clientId: p.client_id, sourceId: `cleo:${targetId}:${now}`, actorUserId: actor.userId });
        } catch (e) {
          console.warn("[cleo] nutrition push failed", e);
        }
      }
      return "Nutrition targets updated.";
    }
    case "move_workout": {
      const { moveScheduledWorkout } = await import("@/lib/scheduled-workouts.functions");
      await moveScheduledWorkout({ data: { instanceId: p.workout_id, newDate: p.date } });
      return "Moved.";
    }
  }
}
