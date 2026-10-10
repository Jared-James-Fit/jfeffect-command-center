/**
 * Cleo's lookups: the tools she calls mid-answer to read a client's file,
 * training log, body weight, records, program, check-ins, nutrition, coach
 * thread, purchases and the calendar.
 *
 * Every read goes through the caller's own client (the finance login's is its
 * read-only admin view), so RLS decides what comes back, exactly as in the
 * app. Rows are trimmed to the fields a coach would read: no tokens, links
 * with secrets or credentials ever reach the model.
 *
 * Never reads member-made chats (chat_groups 'direct' / 'crew'): those are
 * private to their members (AGENTS.md). The coach thread is `messages`.
 */
import { tool } from "ai";
import { z } from "zod";
import { rpcRead } from "@/lib/permissions.server";
import { filterPrimaryProgramBlocks } from "@/lib/at-home-backup";
import {
  bodyweightSummary, dayIn, formatSessions, groupSessions, matchesExercise, mergeBodyweight,
  type BodyweightEntry, type LoggedSet,
} from "@/lib/cleo-data";

const MAX_OUT = 14_000;
const DAY = 86_400_000;
const clientId = z.string().uuid().describe("The client's id from the CLIENTS list.");

function clip(text: string): string {
  return text.length <= MAX_OUT ? text : `${text.slice(0, MAX_OUT)}\n… (cut off; ask for a narrower range)`;
}

function rows<T = any>(res: { data: T[] | null; error: any }, what: string): T[] {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data ?? [];
}

function money(dollars: unknown): string {
  const n = Number(dollars);
  return Number.isFinite(n) ? `$${n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "?";
}

function text(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function answerText(v: unknown): string {
  if (v == null) return "-";
  if (Array.isArray(v)) return v.map(answerText).join(", ");
  if (typeof v === "object") return JSON.stringify(v).slice(0, 300);
  return String(v).slice(0, 600);
}

type ToolCtx = { db: any; tz: string; today: string };

async function clientRow(db: any, id: string): Promise<any> {
  const { data, error } = await db.from("clients").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`client: ${error.message}`);
  if (!data) throw new Error("No client with that id.");
  return data;
}

function clientName(c: any): string {
  return text(c.full_name) ?? (`${c.preferred_name || c.first_name || ""} ${c.last_name ?? ""}`.trim() || c.email || "Client");
}

function liftUnit(c: any): "kg" | "lb" {
  return c?.preferred_weight_unit === "kg" ? "kg" : "lb";
}

/** Runs a lookup and turns any failure into a sentence Cleo can pass on. */
function safe<A>(name: string, fn: (args: A) => Promise<string>) {
  return async (args: A) => {
    try {
      return clip(await fn(args));
    } catch (e: any) {
      return `Couldn't read ${name}: ${e?.message ?? "error"}. Tell the person you couldn't load it; don't guess.`;
    }
  };
}

export function cleoReadTools(ctx: ToolCtx) {
  const { db, tz, today } = ctx;

  return {
    client_file: tool({
      description:
        "A client's file: status, plan, dates, goals, injuries, coach notes, training/nutrition/lifestyle notes, body weight goal, lifting unit, maxes on file and recent pinned notes. Use first when asked about a specific client.",
      inputSchema: z.object({ client_id: clientId }),
      execute: safe("the client file", async ({ client_id }) => {
        const c = await clientRow(db, client_id);
        const [maxes, notes, coach] = await Promise.all([
          db.from("pl_client_maxes").select("*").eq("client_id", client_id).eq("active", true).limit(20),
          db.from("client_file_notes").select("*").eq("client_id", client_id).is("archived_at", null).order("created_at", { ascending: false }).limit(8),
          c.assigned_coach_id ? db.from("coaches").select("full_name").eq("id", c.assigned_coach_id).maybeSingle() : Promise.resolve({ data: null }),
        ]);
        const lines = [
          `${clientName(c)} (${c.id})`,
          `Status: ${c.status ?? "?"} | Plan: ${c.coaching_package || c.coaching_type || "?"} | Started ${c.start_date ?? "?"} | Renews ${c.renewal_date ?? "?"} | Coach: ${coach?.data?.full_name ?? "?"}`,
          `Email ${c.email ?? "-"} | Phone ${c.phone ?? "-"} | Lifting unit ${liftUnit(c)} | Timezone ${c.timezone ?? "?"}`,
          c.bodyweight_goal_value != null
            ? `Body weight goal: ${c.bodyweight_goal_type ?? ""} ${c.bodyweight_goal_value}${c.bodyweight_goal_value_max ? `-${c.bodyweight_goal_value_max}` : ""} ${c.bodyweight_goal_unit ?? ""}`.replace(/\s+/g, " ")
            : null,
          ...[
            ["Goals", c.goals], ["Injuries", c.injuries], ["Program phase", c.program_phase], ["Private coach notes", c.coach_notes],
            ["Training notes", c.training_notes], ["Nutrition notes", c.nutrition_notes], ["Lifestyle notes", c.lifestyle_notes],
            ["Check-in notes (admin)", c.checkin_notes_admin],
          ].filter(([, v]) => text(v)).map(([k, v]) => `${k}: ${String(v).trim().slice(0, 800)}`),
        ].filter(Boolean) as string[];
        const intake = ["squat", "bench", "deadlift"]
          .map((l) => (c[`intake_${l}_1rm`] ? `${l} ${c[`intake_${l}_1rm`]}` : null))
          .filter(Boolean);
        if (intake.length) lines.push(`Intake 1RMs (${c.intake_lift_unit ?? liftUnit(c)}): ${intake.join(", ")}`);
        const mx = rows<any>(maxes as any, "maxes");
        if (mx.length) {
          lines.push("Maxes on file:");
          for (const m of mx) lines.push(`- ${m.lift ?? "lift"}: 1RM ${m.one_rm ?? "-"} | est ${m.estimated_1rm ?? "-"} | TM ${m.training_max ?? "-"} ${m.unit ?? ""} | tested ${m.tested_at ?? "?"}`);
        }
        const nt = rows<any>(notes as any, "notes");
        if (nt.length) {
          lines.push("Coach file notes (newest first):");
          for (const n of nt) lines.push(`- ${String(n.created_at).slice(0, 10)}${n.pinned ? " (pinned)" : ""} ${text(n.title) ?? ""}: ${String(n.body ?? "").slice(0, 400)}`);
        }
        return lines.join("\n");
      }),
    }),

    body_weight: tool({
      description:
        "A client's body weight entries: what they log in the app (portal weigh-ins) and what coaches entered as metrics, newest first, with the latest and the weekly average change.",
      inputSchema: z.object({ client_id: clientId, days: z.number().int().min(7).max(730).default(90).describe("How far back.") }),
      execute: safe("body weight", async ({ client_id, days }) => {
        const c = await clientRow(db, client_id);
        const since = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
        const [portal, metrics] = await Promise.all([
          c.user_id
            ? db.from("progress_bodyweight").select("*").eq("user_id", c.user_id).gte("logged_date", since).order("logged_date", { ascending: false }).limit(400)
            : Promise.resolve({ data: [], error: null }),
          db.from("progress_metrics").select("*").eq("client_id", client_id).gte("entry_date", since).order("entry_date", { ascending: false }).limit(400),
        ]);
        const fromPortal: BodyweightEntry[] = rows<any>(portal as any, "weigh-ins").map((r) => ({
          date: String(r.logged_date).slice(0, 10), value: Number(r.weight_value), unit: r.weight_unit === "kg" ? "kg" : "lb", source: "logged in app", note: text(r.note),
        }));
        const fromMetrics: BodyweightEntry[] = rows<any>(metrics as any, "metrics")
          .filter((r) => r.bodyweight != null)
          .map((r) => ({ date: String(r.entry_date).slice(0, 10), value: Number(r.bodyweight), unit: r.bodyweight_unit === "kg" ? "kg" : "lb", source: "coach metrics", note: text(r.notes) }));
        const all = mergeBodyweight(fromPortal, fromMetrics);
        if (!all.length) return `${clientName(c)} has no body weight logged in the last ${days} days${c.user_id ? "" : " (they don't have an app login yet, so they can't log it themselves)"}.`;
        return [
          `${clientName(c)}: ${bodyweightSummary(all, today)}`,
          `Entries (${all.length}, newest first):`,
          ...all.slice(0, 90).map((e) => `- ${e.date}: ${e.value} ${e.unit} (${e.source})${e.note ? ` "${e.note.slice(0, 80)}"` : ""}`),
        ].join("\n");
      }),
    }),

    training_log: tool({
      description:
        "What a client actually lifted: logged sets (load as entered, reps, RPE/RIR, warm-ups marked) grouped by training day, with the top set's estimated 1RM. Pass `exercise` (e.g. 'high bar squat') to see only that lift, over a longer range for progress questions.",
      inputSchema: z.object({
        client_id: clientId,
        days: z.number().int().min(1).max(365).default(21).describe("How far back. Use 60-180 for progress on one lift."),
        exercise: z.string().max(80).optional().describe("Only sets of exercises whose name matches this."),
      }),
      execute: safe("the training log", async ({ client_id, days, exercise }) => {
        const c = await clientRow(db, client_id);
        const since = new Date(Date.now() - days * DAY).toISOString();
        const [res, comps] = await Promise.all([
          db
            .from("pl_row_results")
            .select("*, pl_exercise_rows!inner(day_id, exercise_name_override, exercises(name))")
            .eq("client_id", client_id)
            .not("completed_at", "is", null)
            .gte("completed_at", since)
            .order("completed_at", { ascending: false })
            .limit(2000),
          db.from("pl_day_completions").select("*").eq("client_id", client_id).gte("completed_at", since).order("completed_at", { ascending: false }).limit(60),
        ]);
        const raw = rows<any>(res as any, "logged sets");
        const named = raw.map((r) => ({ r, name: text(r.pl_exercise_rows?.exercises?.name) ?? text(r.pl_exercise_rows?.exercise_name_override) ?? "Exercise" }));
        const picked = named.filter((x) => matchesExercise(x.name, exercise));
        const dayIds = [...new Set(picked.map((x) => x.r.pl_exercise_rows?.day_id).filter(Boolean))];
        const titles = new Map<string, string>();
        if (dayIds.length) {
          const d = await db.from("pl_days").select("id, title").in("id", dayIds.slice(0, 300));
          for (const row of rows<any>(d, "days")) if (row.title) titles.set(row.id, row.title);
        }
        const sets: LoggedSet[] = picked.map(({ r, name }) => ({
          completed_at: r.completed_at,
          exercise: name,
          day_title: titles.get(r.pl_exercise_rows?.day_id) ?? null,
          set_index: r.set_index ?? null,
          entered_value: r.entered_value ?? r.actual_load ?? null,
          entered_unit: r.entered_unit ?? r.actual_load_unit ?? null,
          normalized_kg: r.normalized_kg ?? r.actual_load_kg ?? null,
          normalized_lb: r.normalized_lb ?? r.actual_load_lb ?? null,
          reps: r.actual_reps ?? null,
          rpe: r.actual_rpe_num ?? r.actual_rpe ?? null,
          rir: r.actual_rir ?? null,
          is_working_set: r.is_working_set ?? null,
          load_type: r.load_type ?? null,
          is_bodyweight: r.is_bodyweight ?? null,
          notes: r.notes ?? null,
        }));
        if (!sets.length) {
          const what = exercise ? `no logged sets matching "${exercise}"` : "no logged sets";
          const names = [...new Set(named.map((x) => x.name))].slice(0, 30);
          return `${clientName(c)} has ${what} in the last ${days} days.${exercise && names.length ? ` Exercises they did log: ${names.join(", ")}.` : ""}`;
        }
        const sessions = groupSessions(sets, tz).slice(0, exercise ? 40 : 14);
        const notes = rows<any>(comps as any, "sessions")
          .filter((s) => s.completed_at && (s.session_rating != null || text(s.client_notes)))
          .slice(0, 14)
          .map((s) => `- ${dayIn(s.completed_at, tz)}: rating ${s.session_rating ?? "-"}${text(s.client_notes) ? ` | "${String(s.client_notes).slice(0, 200)}"` : ""}`);
        return [
          `${clientName(c)} | loads as they entered them; e1RM in ${liftUnit(c)} | last ${days} days${exercise ? ` | matching "${exercise}"` : ""}`,
          formatSessions(sessions, liftUnit(c)),
          ...(notes.length ? ["Session ratings and notes:", ...notes] : []),
        ].join("\n");
      }),
    }),

    personal_records: tool({
      description: "A client's recent PRs: all-time, program and block records by reps and by load, and tonnage records.",
      inputSchema: z.object({ client_id: clientId, days: z.number().int().min(7).max(365).default(60) }),
      execute: safe("records", async ({ client_id, days }) => {
        const c = await clientRow(db, client_id);
        const unit = liftUnit(c);
        const { data, error } = await rpcRead(db, "client_recent_records", { _client_id: client_id, _since: new Date(Date.now() - days * DAY).toISOString() });
        if (error) throw new Error(error.message);
        const kg = (v: unknown) => {
          const n = Number(v);
          if (!Number.isFinite(n)) return "?";
          return unit === "kg" ? `${Math.round(n * 2) / 2} kg` : `${Math.round(n * 2.2046226218 * 2) / 2} lb`;
        };
        const kind = (r: any) => (r.atpr ? "ALL-TIME PR" : r.program_pr ? "program PR" : r.block_pr ? "block PR" : "PR");
        const lines = [`${clientName(c)} records, last ${days} days (converted to ${unit}):`];
        for (const r of (data?.records ?? []) as any[]) lines.push(`- ${dayIn(r.at, tz)} ${r.exercise_name}: ${kg(r.load_kg)} x ${r.reps} (${kind(r)}${r.prev_all_kg != null ? `, previous best ${kg(r.prev_all_kg)}` : ""})`);
        for (const r of (data?.load_records ?? []) as any[]) lines.push(`- ${dayIn(r.at, tz)} ${r.exercise_name}: heaviest ${kg(r.load_kg)} x ${r.reps} (${kind(r)} by load)`);
        for (const t of (data?.tonnage ?? []) as any[]) lines.push(`- ${dayIn(t.at, tz)} session tonnage ${kg(t.tonnage_kg)} (${kind(t)})`);
        return lines.length > 1 ? lines.join("\n") : `${clientName(c)} has no PRs in the last ${days} days.`;
      }),
    }),

    training_program: tool({
      description:
        "A client's program: blocks (current one first), and their schedule from 7 days ago to 14 days ahead with which workouts are done. Pass `date` (YYYY-MM-DD) to also get the prescribed exercises for that day's workout.",
      inputSchema: z.object({ client_id: clientId, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
      execute: safe("the program", async ({ client_id, date }) => {
        const c = await clientRow(db, client_id);
        const from = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * DAY).toISOString().slice(0, 10);
        const to = new Date(Date.parse(`${today}T00:00:00Z`) + 14 * DAY).toISOString().slice(0, 10);
        const [blocksRes, schedRes] = await Promise.all([
          db.from("pl_blocks").select("*").eq("client_id", client_id).order("start_date", { ascending: false }).limit(30),
          db.from("pl_scheduled_workouts").select("*").eq("client_id", client_id).gte("scheduled_date", date && date < from ? date : from).lte("scheduled_date", date && date > to ? date : to).order("scheduled_date").limit(80),
        ]);
        const blocks = filterPrimaryProgramBlocks(rows<any>(blocksRes as any, "blocks")).filter((b) => !b.archived);
        const sched = rows<any>(schedRes as any, "schedule");
        const dayIds = [...new Set(sched.map((s) => s.source_day_id).filter(Boolean))];
        const [daysRes, compRes] = await Promise.all([
          dayIds.length ? db.from("pl_days").select("id, title, focus").in("id", dayIds) : Promise.resolve({ data: [], error: null }),
          sched.length ? db.from("pl_day_completions").select("scheduled_workout_id, completed_at, session_rating").in("scheduled_workout_id", sched.map((s) => s.id)) : Promise.resolve({ data: [], error: null }),
        ]);
        const days = new Map(rows<any>(daysRes as any, "days").map((d) => [d.id, d]));
        const done = new Map(rows<any>(compRes as any, "completions").filter((x) => x.completed_at).map((x) => [x.scheduled_workout_id, x]));
        const current = blocks.find((b) => b.status === "Active" && (!b.start_date || b.start_date <= today) && (!b.end_date || b.end_date >= today)) ?? blocks.find((b) => b.status === "Active");
        const lines = [`${clientName(c)} program:`];
        if (!blocks.length) lines.push("- no program blocks");
        for (const b of [current, ...blocks.filter((b) => b !== current)].filter(Boolean).slice(0, 8)) {
          lines.push(`- ${b === current ? "CURRENT " : ""}${b.name ?? "Block"} | block id ${b.id} | ${b.status ?? "?"} | ${b.client_visible ? "published" : "HIDDEN from client"} | ${b.start_date ?? "?"} to ${b.end_date ?? "?"} | ${b.weeks ?? "?"} weeks`);
        }
        lines.push(`Schedule ${from} to ${to}:`);
        for (const s of sched) {
          const d = days.get(s.source_day_id);
          const comp = done.get(s.id);
          lines.push(`- ${s.scheduled_date}${s.scheduled_time ? ` ${String(s.scheduled_time).slice(0, 5)}` : ""} | ${d?.title ?? "Workout"}${d?.focus ? ` (${d.focus})` : ""} | ${comp ? `done${comp.session_rating != null ? `, rated ${comp.session_rating}` : ""}` : s.scheduled_date < today ? "NOT logged" : "upcoming"} | workout id ${s.id} | day id ${s.source_day_id}`);
        }
        if (!sched.length) lines.push("- nothing scheduled");
        if (date) {
          const onDay = sched.filter((s) => s.scheduled_date === date);
          if (!onDay.length) lines.push(`No workout scheduled on ${date}.`);
          for (const s of onDay) {
            const ex = await db.from("pl_exercise_rows").select("*, exercises(name)").eq("day_id", s.source_day_id).limit(40);
            const list = rows<any>(ex as any, "exercises").sort((a, b) => (a.sort_order ?? a.position ?? a.row_index ?? 0) - (b.sort_order ?? b.position ?? b.row_index ?? 0));
            lines.push(`Prescription for ${date} (${days.get(s.source_day_id)?.title ?? "workout"}):`);
            for (const r of list) {
              const load = r.percentage ? `${r.percentage}%` : r.load_kg || r.load_lb ? `${r.load_unit === "kg" ? r.load_kg : r.load_lb ?? r.load_kg} ${r.load_unit ?? ""}`.trim() : "";
              lines.push(`- ${text(r.exercises?.name) ?? text(r.exercise_name_override) ?? "Exercise"}: ${r.sets ?? "?"} x ${r.reps_text ?? "?"}${r.rpe ? ` @RPE ${r.rpe}` : r.rir ? ` @${r.rir} RIR` : ""}${load ? ` | ${load}` : ""}${text(r.notes) ? ` | ${String(r.notes).slice(0, 120)}` : ""}`);
            }
          }
        }
        return lines.join("\n");
      }),
    }),

    check_ins: tool({
      description: "A client's recent weekly check-ins and form submissions with their answers, workout feedback with pain flags, and what's still waiting for review.",
      inputSchema: z.object({ client_id: clientId, limit: z.number().int().min(1).max(8).default(3) }),
      execute: safe("check-ins", async ({ client_id, limit }) => {
        const c = await clientRow(db, client_id);
        const [weekly, forms, reviews, feedback] = await Promise.all([
          db.from("messenger_checkins").select("*").eq("client_id", client_id).not("submitted_at", "is", null).order("submitted_at", { ascending: false }).limit(limit),
          db.from("nf_submissions").select("*").eq("client_id", client_id).order("submitted_at", { ascending: false }).limit(limit),
          db.from("submission_reviews").select("*").eq("client_id", client_id).in("review_status", ["submitted", "processing", "needs_review", "draft_ready", "coach_editing"]).limit(10),
          db.from("pl_workout_feedback").select("*").eq("client_id", client_id).order("created_at", { ascending: false }).limit(10),
        ]);
        const lines = [`${clientName(c)} check-ins:`];
        for (const w of rows<any>(weekly as any, "weekly check-ins")) {
          lines.push(`Weekly check-in ${dayIn(w.submitted_at, tz)}${w.reviewed_at ? " (reviewed)" : " (NOT reviewed)"}:`);
          for (const [k, v] of Object.entries(w.answers ?? {})) lines.push(`  ${k.replace(/_/g, " ")}: ${answerText(v)}`);
        }
        const subs = rows<any>(forms as any, "form submissions");
        if (subs.length) {
          const ans = rows<any>(await db.from("nf_answers").select("*").in("submission_id", subs.map((s) => s.id)).limit(400), "answers");
          const qIds = [...new Set(ans.map((a) => a.question_id).filter(Boolean))];
          const qs = qIds.length ? rows<any>(await db.from("nf_questions").select("id, label").in("id", qIds), "questions") : [];
          const label = new Map(qs.map((q) => [q.id, q.label]));
          for (const s of subs) {
            lines.push(`Form ${s.submitted_at ? dayIn(s.submitted_at, tz) : "?"} | ${s.status ?? "?"}:`);
            for (const a of ans.filter((a) => a.submission_id === s.id).slice(0, 40)) {
              lines.push(`  ${label.get(a.question_id) ?? "Question"}: ${answerText(a.value_text ?? a.value_number ?? a.value_json)}`);
            }
          }
        }
        const open = rows<any>(reviews as any, "reviews");
        if (open.length) lines.push(`Waiting for review: ${open.map((r) => `${r.source_type ?? "check-in"} (${r.review_status}${r.priority && r.priority !== "normal" ? `, ${r.priority}` : ""})`).join("; ")}`);
        const fb = rows<any>(feedback as any, "workout feedback").filter((f) => f.pain || f.pain_level || f.overall_rating != null || f.session_rpe != null);
        if (fb.length) {
          lines.push("Workout feedback:");
          for (const f of fb) lines.push(`- ${dayIn(f.created_at, tz)} | rating ${f.overall_rating ?? "-"} | session RPE ${f.session_rpe ?? "-"}${f.pain ? ` | PAIN ${f.pain_area ?? ""} ${f.pain_level ?? ""}`.trimEnd() : ""}${f.reviewed_at ? "" : " | not reviewed"}`);
        }
        return lines.length > 1 ? lines.join("\n") : `${clientName(c)} has no check-ins on file.`;
      }),
    }),

    nutrition: tool({
      description: "A client's nutrition targets (calories, protein, carbs, fats per day type), phase, goal and notes.",
      inputSchema: z.object({ client_id: clientId }),
      execute: safe("nutrition", async ({ client_id }) => {
        const c = await clientRow(db, client_id);
        const res = await db.from("nutrition_targets").select("*, nutrition_target_days(*)").eq("client_id", client_id).order("created_at", { ascending: false }).limit(5);
        const list = rows<any>(res as any, "nutrition targets");
        if (!list.length) return `${clientName(c)} has no nutrition targets set.`;
        const lines = [`${clientName(c)} nutrition targets (food logs aren't visible to coaches):`];
        for (const t of list.sort((a, b) => (a.status === "Active" ? -1 : 0) - (b.status === "Active" ? -1 : 0)).slice(0, 3)) {
          lines.push(`${t.status ?? "?"} | goal ${t.goal ?? "?"} | phase ${t.phase ?? "?"} | ${t.start_date ?? "?"} to ${t.end_date ?? "open"}${t.visible_to_client === false ? " | hidden from client" : ""}${t.water ? ` | water ${t.water}` : ""}`);
          for (const d of (t.nutrition_target_days ?? []) as any[]) lines.push(`  ${d.day_label ?? "Day"}: ${d.calories ?? "?"} kcal | P ${d.protein ?? "?"}g C ${d.carbs ?? "?"}g F ${d.fats ?? "?"}g${d.fibre ? ` fibre ${d.fibre}g` : ""}`);
          if (text(t.admin_notes)) lines.push(`  Coach notes: ${String(t.admin_notes).slice(0, 400)}`);
        }
        return lines.join("\n");
      }),
    }),

    message_thread: tool({
      description: "The recent coach-client message thread (and staff internal notes on it), newest last. Use to see what a client said or asked.",
      inputSchema: z.object({ client_id: clientId, limit: z.number().int().min(1).max(60).default(20) }),
      execute: safe("messages", async ({ client_id, limit }) => {
        const c = await clientRow(db, client_id);
        const res = await db
          .from("messages")
          .select("sender_role, body, created_at, is_internal_note, attachments, delivery_status, scheduled_at")
          .eq("client_id", client_id)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(limit);
        const list = rows<any>(res as any, "messages").reverse();
        if (!list.length) return `No messages with ${clientName(c)} yet.`;
        return [
          `Thread with ${clientName(c)} (oldest first):`,
          ...list.map((m) => {
            const who = m.is_internal_note ? "INTERNAL NOTE" : m.sender_role === "client" ? clientName(c) : "Coach";
            const files = Array.isArray(m.attachments) && m.attachments.length ? ` [${m.attachments.length} attachment${m.attachments.length > 1 ? "s" : ""}]` : "";
            const when = m.delivery_status === "scheduled" && m.scheduled_at ? `scheduled for ${dayIn(m.scheduled_at, tz)}` : new Date(m.created_at).toLocaleString("en-CA", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
            return `- ${when} | ${who}: ${String(m.body ?? "").slice(0, 600)}${files}`;
          }),
        ].join("\n");
      }),
    }),

    purchases: tool({
      description: "A client's purchases: what they bought, payment status, paid, outstanding, next billing date, with each purchase's id (needed to record a payment or send a payment link).",
      inputSchema: z.object({ client_id: clientId }),
      execute: safe("purchases", async ({ client_id }) => {
        const c = await clientRow(db, client_id);
        const res = await db.from("purchase_records").select("*").eq("client_id", client_id).is("archived_at", null).order("purchased_at", { ascending: false, nullsFirst: false }).limit(20);
        const list = rows<any>(res as any, "purchases");
        if (!list.length) return `${clientName(c)} has no purchases.`;
        return [
          `${clientName(c)} purchases:`,
          ...list.map((p) => {
            const owed = p.amount_outstanding_cents != null ? `$${(Number(p.amount_outstanding_cents) / 100).toFixed(2)}` : "?";
            return `- ${p.offer_name ?? "Purchase"} (purchase id ${p.id}) | ${p.payment_status ?? "?"} | total ${money(p.full_payable_amount)} | paid ${money(p.amount_paid)} | outstanding ${owed} | bought ${String(p.purchased_at ?? "?").slice(0, 10)}${p.next_billing_date ? ` | next billing ${p.next_billing_date}` : ""}`;
          }),
        ].join("\n");
      }),
    }),

    team_training: tool({
      description:
        "Across ALL clients: scheduled workouts in the last N days, how many were logged, and which were missed (scheduled, past, not logged). Use for 'who missed workouts', 'who's on track', 'who hasn't trained'.",
      inputSchema: z.object({ days: z.number().int().min(1).max(30).default(7) }),
      execute: safe("team training", async ({ days }) => {
        const from = new Date(Date.parse(`${today}T00:00:00Z`) - days * DAY).toISOString().slice(0, 10);
        const [schedRes, compRes] = await Promise.all([
          db.from("pl_scheduled_workouts").select("id, client_id, scheduled_date, source_day_id").gte("scheduled_date", from).lt("scheduled_date", today).limit(3000),
          db.from("pl_day_completions").select("scheduled_workout_id, client_id, completed_at").gte("completed_at", new Date(Date.parse(`${from}T00:00:00Z`) - 3 * DAY).toISOString()).limit(5000),
        ]);
        const sched = rows<any>(schedRes as any, "schedule");
        const done = new Set(rows<any>(compRes as any, "completions").filter((c) => c.completed_at).map((c) => c.scheduled_workout_id));
        const per = new Map<string, { total: number; done: number; missed: string[] }>();
        for (const w of sched) {
          const p = per.get(w.client_id) ?? { total: 0, done: 0, missed: [] };
          p.total += 1;
          if (done.has(w.id)) p.done += 1;
          else p.missed.push(w.scheduled_date);
          per.set(w.client_id, p);
        }
        if (!per.size) return `No workouts were scheduled from ${from} to yesterday.`;
        const ids = [...per.keys()];
        const names = new Map<string, any>();
        for (let i = 0; i < ids.length; i += 150) {
          for (const r of rows<any>(await db.from("clients").select("id, full_name, preferred_name, first_name, last_name, email, archived, archived_at, deactivated_at").in("id", ids.slice(i, i + 150)), "clients")) names.set(r.id, r);
        }
        const list = [...per.entries()]
          .filter(([id]) => { const c = names.get(id); return c && !(c.archived || c.archived_at || c.deactivated_at); })
          .sort((a, b) => b[1].missed.length - a[1].missed.length || a[1].done / a[1].total - b[1].done / b[1].total);
        return [
          `Scheduled workouts ${from} to yesterday (current clients), most missed first:`,
          ...list.map(([id, p]) => `- ${clientName(names.get(id))} (${id}) | logged ${p.done}/${p.total}${p.missed.length ? ` | missed ${p.missed.sort().join(", ")}` : " | none missed"}`),
        ].join("\n");
      }),
    }),

    pain_flags: tool({
      description: "Across ALL clients: pain or injury flags from workout feedback and weekly check-ins in the last N days, newest first, with whether they were reviewed.",
      inputSchema: z.object({ days: z.number().int().min(1).max(60).default(14) }),
      execute: safe("pain flags", async ({ days }) => {
        const since = new Date(Date.now() - days * DAY).toISOString();
        const [fbRes, ciRes] = await Promise.all([
          db.from("pl_workout_feedback").select("client_id, created_at, pain, pain_area, pain_level, reviewed_at").gte("created_at", since).order("created_at", { ascending: false }).limit(500),
          db.from("messenger_checkins").select("client_id, submitted_at, answers, reviewed_at").gte("submitted_at", since).order("submitted_at", { ascending: false }).limit(300),
        ]);
        const items: Array<{ at: string; client: string; text: string }> = [];
        for (const f of rows<any>(fbRes as any, "workout feedback")) {
          if (!f.pain && !f.pain_level) continue;
          items.push({ at: f.created_at, client: f.client_id, text: `workout pain ${[f.pain_area, f.pain_level != null ? `level ${f.pain_level}` : null].filter(Boolean).join(", ") || "reported"}${f.reviewed_at ? "" : " (not reviewed)"}` });
        }
        for (const c of rows<any>(ciRes as any, "check-ins")) {
          const a = c.answers ?? {};
          const pain = [answerText(a.pain_details), answerText(a.recovery_flags)].filter((x) => x && x !== "-" && !/^(none|no|n\/a|\[\])$/i.test(x.trim()));
          if (!pain.length) continue;
          items.push({ at: c.submitted_at, client: c.client_id, text: `check-in: ${pain.join(" | ").slice(0, 300)}${c.reviewed_at ? "" : " (not reviewed)"}` });
        }
        if (!items.length) return `No pain flags in the last ${days} days.`;
        const ids = [...new Set(items.map((i) => i.client).filter(Boolean))];
        const names = new Map<string, string>();
        for (const r of rows<any>(await db.from("clients").select("id, full_name, preferred_name, first_name, last_name, email").in("id", ids.slice(0, 200)), "clients")) names.set(r.id, clientName(r));
        return items
          .sort((a, b) => String(b.at).localeCompare(String(a.at)))
          .map((i) => `- ${dayIn(i.at, tz)} | ${names.get(i.client) ?? "client"} (${i.client}) | ${i.text}`)
          .join("\n");
      }),
    }),

    calendar: tool({
      description: "Appointments and PT sessions between two dates (YYYY-MM-DD, inclusive), for any range beyond the 14 days already in APP.",
      inputSchema: z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
      execute: safe("the calendar", async ({ from, to }) => {
        const start = new Date(`${from}T00:00:00Z`).toISOString();
        const end = new Date(Date.parse(`${to}T00:00:00Z`) + 2 * DAY).toISOString();
        const [appts, pts] = await Promise.all([
          db.from("appointments").select("*").gte("starts_at", start).lte("starts_at", end).is("cancelled_at", null).order("starts_at").limit(150),
          db.from("pt_sessions").select("*").gte("starts_at", start).lte("starts_at", end).order("starts_at").limit(150),
        ]);
        const items = [
          ...rows<any>(appts as any, "appointments").map((a) => ({ at: a.starts_at, what: a.title ?? a.appointment_type ?? "Appointment", client: a.client_id, other: a.external_name, status: a.status })),
          ...rows<any>(pts as any, "PT sessions").map((p) => ({ at: p.starts_at, what: "PT session", client: p.client_id, other: null, status: p.status })),
        ]
          .filter((i) => i.at && dayIn(i.at, tz) >= from && dayIn(i.at, tz) <= to)
          .sort((a, b) => String(a.at).localeCompare(String(b.at)));
        if (!items.length) return `Nothing booked from ${from} to ${to}.`;
        const ids = [...new Set(items.map((i) => i.client).filter(Boolean))];
        const names = new Map<string, string>();
        if (ids.length) for (const r of rows<any>(await db.from("clients").select("id, full_name, preferred_name, first_name, last_name, email").in("id", ids), "clients")) names.set(r.id, clientName(r));
        return items
          .map((i) => `- ${new Date(i.at).toLocaleString("en-CA", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} | ${i.what} | ${i.client ? `${names.get(i.client) ?? "client"} (${i.client})` : i.other ?? "-"} | ${i.status ?? ""}`)
          .join("\n");
      }),
    }),
  };
}
