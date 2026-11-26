import { PAIN_RULES } from "@/lib/pain/rules";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ensureNextOccurrence } from "@/lib/action-centre.functions";
import { casualize } from "@/lib/coach-voice";
import { fitReply, replyKindFor, replyLengthRule } from "@/lib/autopilot/reply";
import { voicePromptForClient } from "@/lib/coach-voice.functions";
import { PROGRAM_CONTEXT_RULES, programContextText, publicProgramContext } from "@/lib/program-context";

export type MessengerCheckinTaskType = "weekly_checkin";

export type MessengerCheckinAnalysis = {
  /** Set on the stand-in written when the recap model didn't answer (`fallbackAnalysis`). */
  fallback?: boolean;
  summary: string;
  wins: string[];
  focus: string[];
  goals: string[];
  red_flags: string[];
  coach_notes: string[];
  suggested_response: string;
  urgency: "low" | "normal" | "high" | "urgent";
};

const taskSchema = z.enum(["weekly_checkin"]);

const ANSWER_LABELS: Record<MessengerCheckinTaskType, Record<string, string>> = {
  weekly_checkin: {
    week_rating: "Overall week",
    training_rating: "Training rating (1–5)",
    nutrition_rating: "Nutrition consistency rating (1–5)",
    recovery_flags: "Recovery / issues",
    pain_details: "Pain / injury details",
    digestion_symptoms: "Digestion: what's going on",
    digestion_timing: "Digestion: when",
    digestion_severity: "Digestion: how bad (1–5)",
    hunger_level: "Hunger (1–5)",
    cardio_issue: "Cardio: what happened",
    water_issue: "Water: what's getting in the way",
    win: "Biggest win",
    help: "Help or changes needed",
    next_week_goal: "Main goal for next week",
  },
};

const TASK_META: Record<MessengerCheckinTaskType, { title: string; body: string }> = {
  weekly_checkin: {
    title: "Weekly Check-In",
    body: "Quick 60-second weekly check-in 👇",
  },
};

function localDateInTimeZone(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;
    return `${map.year}-${map.month}-${map.day}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Duplicate-send guard for automated requests (manual coach requests have no
 * occurrence and are never blocked). Weekly: at most one per 4 days. Keep in sync with the SQL guard in
 * enqueue_due_messenger_checkins().
 */
export function automatedRequestAlreadySent(
  taskType: MessengerCheckinTaskType,
  today: string,
  priorRequestLocalDates: string[],
): boolean {
  return priorRequestLocalDates.some((d) => {
    const diff = dayDiff(d, today);
    return diff >= 0 && diff < 4;
  });
}

function localDateOf(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function dayDiff(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso + "T00:00:00Z");
  const b = Date.parse(toIso + "T00:00:00Z");
  return Math.round((b - a) / 86_400_000);
}

async function adminClient(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function resolveClientAccess(
  supabase: any,
  userId: string,
  clientId: string,
): Promise<"admin" | "coach" | "client"> {
  const { data: isAdmin } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (isAdmin === true) return "admin";

  const { data: client } = await supabase
    .from("clients")
    .select("id,user_id,assigned_coach_id")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) throw new Error("Client not found.");
  if (client.user_id === userId) return "client";

  if (client.assigned_coach_id) {
    const { data: coach } = await supabase
      .from("coaches")
      .select("user_id")
      .eq("id", client.assigned_coach_id)
      .maybeSingle();
    if (coach?.user_id === userId) return "coach";
  }
  throw new Error("You do not have access to this check-in.");
}

async function automationSenderId(sb: any, clientId: string): Promise<string | null> {
  const { data: client } = await sb
    .from("clients")
    .select("assigned_coach_id")
    .eq("id", clientId)
    .maybeSingle();
  if (client?.assigned_coach_id) {
    const { data: coach } = await sb
      .from("coaches")
      .select("user_id")
      .eq("id", client.assigned_coach_id)
      .maybeSingle();
    if (coach?.user_id) return coach.user_id;
  }
  const { data: adminRole } = await sb
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();
  return adminRole?.user_id ?? null;
}

async function createRequest(
  sb: any,
  input: {
    clientId: string;
    taskType: MessengerCheckinTaskType;
    occurrenceId?: string | null;
    senderId?: string | null;
    note?: string | null;
  },
) {
  if (input.occurrenceId) {
    const { data: existing } = await sb
      .from("messenger_checkins")
      .select("id,request_message_id,status")
      .eq("occurrence_id", input.occurrenceId)
      .maybeSingle();
    if (existing) return existing;
  }

  const { data: checkin, error: insErr } = await sb
    .from("messenger_checkins")
    .insert({
      client_id: input.clientId,
      occurrence_id: input.occurrenceId ?? null,
      task_type: input.taskType,
      status: "pending",
      ai_status: "pending",
    })
    .select("id,status")
    .single();
  if (insErr) {
    if (input.occurrenceId && /duplicate|unique/i.test(insErr.message ?? "")) {
      const { data: existing } = await sb
        .from("messenger_checkins")
        .select("id,request_message_id,status")
        .eq("occurrence_id", input.occurrenceId)
        .maybeSingle();
      if (existing) return existing;
    }
    throw new Error(insErr.message);
  }

  const senderId = input.senderId ?? (await automationSenderId(sb, input.clientId));
  const meta = TASK_META[input.taskType];
  const requestBody = input.note?.trim()
    ? `${meta.body}\n\n${input.note.trim()}`
    : meta.body;
  const { data: message, error: msgErr } = await sb
    .from("messages")
    .insert({
      client_id: input.clientId,
      sender_id: senderId,
      sender_role: "admin",
      body: requestBody,
      attachments: [
        {
          type: "file",
          url: "",
          kind: "checkin_request",
          checkin_submission_id: checkin.id,
          checkin_occurrence_id: input.occurrenceId ?? null,
          checkin_task_type: input.taskType,
          request_title: meta.title,
        },
      ],
      message_type: "Check-In",
      is_internal_note: false,
      delivery_status: "sent",
      sent_at: new Date().toISOString(),
      read_by_admin_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (msgErr) {
    await sb.from("messenger_checkins").delete().eq("id", checkin.id);
    throw new Error(msgErr.message);
  }

  await sb
    .from("messenger_checkins")
    .update({ request_message_id: message.id, updated_at: new Date().toISOString() })
    .eq("id", checkin.id);

  return { ...checkin, request_message_id: message.id };
}

/** Server-only: used by the admin Requests tracker to re-send a check-in. */
export { createRequest as createMessengerCheckinRequest };

export const ensureDueMessengerCheckins = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId?: string }) =>
    z.object({ clientId: z.string().uuid().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let clientId = data.clientId;
    if (!clientId) {
      const { data: client } = await context.supabase
        .from("clients")
        .select("id")
        .eq("user_id", context.userId)
        .maybeSingle();
      clientId = client?.id;
    }
    if (!clientId) return { ok: false as const, created: 0 };
    // check-ins come from a coach: none for a JF member
    const { data: tierRow } = await context.supabase.from("clients").select("service_tier").eq("id", clientId).maybeSingle();
    if ((tierRow as any)?.service_tier === "self_serve") return { ok: false as const, created: 0 };

    const actor = await resolveClientAccess(context.supabase, context.userId, clientId);
    if (actor !== "client" && actor !== "admin" && actor !== "coach") {
      return { ok: false as const, created: 0 };
    }

    const sb = await adminClient();
    const { data: occurrences } = await sb
      .from("client_task_occurrences")
      .select("id,task_type,due_local_date,client_tz,status")
      .eq("client_id", clientId)
      .in("task_type", ["weekly_checkin"])
      .not("status", "in", "(completed,skipped)")
      .order("due_at_utc", { ascending: true })
      .limit(8);

    let created = 0;
    for (const occ of occurrences ?? []) {
      const taskType = occ.task_type as MessengerCheckinTaskType;
      const today = localDateInTimeZone(occ.client_tz || "UTC");
      const daysUntil = dayDiff(today, occ.due_local_date);
      // Never backfill old/overdue requests. Weekly check-ins are due Sunday
      // night but surface on Friday so clients have the full weekend to submit.
      const dueNow = daysUntil >= 0 && daysUntil <= 2;
      if (!dueNow) continue;

      const { data: existing } = await sb
        .from("messenger_checkins")
        .select("id")
        .eq("occurrence_id", occ.id)
        .maybeSingle();
      if (existing) continue;

      const { data: prior } = await sb
        .from("messenger_checkins")
        .select("created_at")
        .eq("client_id", clientId)
        .eq("task_type", taskType)
        .not("occurrence_id", "is", null)
        .gte("created_at", new Date(Date.now() - 40 * 86_400_000).toISOString());
      const priorDates = (prior ?? []).map((p: any) =>
        localDateOf(p.created_at, occ.client_tz || "UTC"),
      );
      if (automatedRequestAlreadySent(taskType, today, priorDates)) continue;

      await createRequest(sb, {
        clientId,
        taskType,
        occurrenceId: occ.id,
      });
      created++;
    }
    return { ok: true as const, created };
  });

export const sendMessengerCheckinRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    clientId: string;
    taskType: MessengerCheckinTaskType;
    note?: string | null;
  }) =>
    z.object({
      clientId: z.string().uuid(),
      taskType: taskSchema,
      note: z.string().max(500).nullish(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const actor = await resolveClientAccess(context.supabase, context.userId, data.clientId);
    if (actor === "client") throw new Error("Coach access required.");
    const sb = await adminClient();
    const created = await createRequest(sb, {
      clientId: data.clientId,
      taskType: data.taskType,
      senderId: context.userId,
      note: data.note ?? null,
    });
    const { notifyAppEvent } = await import("@/lib/push/app-events.server");
    await notifyAppEvent(sb, "checkin_requested", {
      clientId: data.clientId,
      sourceId: created.id,
      actorUserId: context.userId,
    });
    return created;
  });

export const getMessengerCheckin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { submissionId: string }) =>
    z.object({ submissionId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = await adminClient();
    const { data: row, error } = await sb
      .from("messenger_checkins")
      .select("*")
      .eq("id", data.submissionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Check-in not found.");
    await resolveClientAccess(context.supabase, context.userId, row.client_id);
    return row;
  });

function isoDateAdd(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isoWeekMonday(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay(); // Sun=0 ... Sat=6
  const offset = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

function normalizeWeight(value: number, unit: string, targetUnit: string): number {
  if (unit === targetUnit) return value;
  return unit === "kg" ? value * 2.2046226 : value / 2.2046226;
}

async function buildContextSnapshot(
  sb: any,
  clientId: string,
  opts?: { dueLocalDate?: string | null; clientTz?: string | null },
) {
  const { data: client } = await sb
    .from("clients")
    .select("id,user_id,full_name,preferred_weight_unit,timezone,committed_training_days,committed_training_frequency")
    .eq("id", clientId)
    .maybeSingle();
  if (!client?.user_id) return { client_name: client?.full_name ?? null };

  // Weekly check-ins summarize the scheduled training period ending on the
  // check-in due date. A rolling 7-day completion count can leak a prior
  // Sunday's workout into a Saturday check-in and overstate adherence.
  const contextDate = localDateInTimeZone(opts?.clientTz || client.timezone || "UTC");
  const periodEnd = opts?.dueLocalDate || contextDate;
  const periodStart = isoWeekMonday(periodEnd);

  // Weight context can include a same-day weigh-in submitted after the formal
  // check-in deadline; workout adherence still stops at the due date above.
  const bwEnd = contextDate;
  const bwStart = isoDateAdd(bwEnd, -13);
  const currentBwStart = isoDateAdd(bwEnd, -6);
  const previousBwEnd = isoDateAdd(bwEnd, -7);

  const [
    { data: bw },
    { data: completions },
    { data: canonicalScheduled },
  ] = await Promise.all([
    sb
      .from("progress_bodyweight")
      .select("logged_date,weight_value,weight_unit")
      .eq("user_id", client.user_id)
      .gte("logged_date", bwStart)
      .lte("logged_date", bwEnd)
      .order("logged_date", { ascending: true }),
    sb
      .from("pl_day_completions")
      .select("id,day_id,scheduled_workout_id,completed_at")
      .eq("client_id", clientId)
      .gte("completed_at", `${isoDateAdd(periodStart, -7)}T00:00:00Z`)
      .lte("completed_at", `${isoDateAdd(periodEnd, 7)}T23:59:59Z`),
    sb
      .from("pl_scheduled_workouts")
      .select("id,source_day_id,scheduled_date")
      .eq("client_id", clientId)
      .gte("scheduled_date", periodStart)
      .lte("scheduled_date", periodEnd)
      .order("scheduled_date", { ascending: true }),
  ]);

  const completionRows = completions ?? [];
  const scheduledIds = Array.from(new Set(
    completionRows.map((r: any) => r.scheduled_workout_id).filter(Boolean),
  ));
  const dayIds = Array.from(new Set(
    completionRows.map((r: any) => r.day_id).filter(Boolean),
  ));

  const [{ data: completionSchedules }, { data: completionDays }] = await Promise.all([
    scheduledIds.length
      ? sb.from("pl_scheduled_workouts").select("id,scheduled_date").in("id", scheduledIds)
      : Promise.resolve({ data: [] }),
    dayIds.length
      ? sb.from("pl_days").select("id,scheduled_date").in("id", dayIds)
      : Promise.resolve({ data: [] }),
  ]);

  const scheduledDateById = new Map<string, string>(
    (completionSchedules ?? []).map((r: any) => [r.id, r.scheduled_date] as [string, string]),
  );
  const dayDateById = new Map<string, string>(
    (completionDays ?? []).map((r: any) => [r.id, r.scheduled_date] as [string, string]),
  );

  const completedKeys = new Set<string>();
  const completedDates = new Set<string>();
  for (const row of completionRows) {
    const scheduledDate = row.scheduled_workout_id
      ? scheduledDateById.get(row.scheduled_workout_id)
      : dayDateById.get(row.day_id);
    if (!scheduledDate || scheduledDate < periodStart || scheduledDate > periodEnd) continue;
    completedKeys.add(
      row.scheduled_workout_id
        ? `sw:${row.scheduled_workout_id}`
        : `day:${row.day_id}`,
    );
    completedDates.add(scheduledDate);
  }

  let plannedWorkouts = (canonicalScheduled ?? []).length;
  let scheduleSource: "canonical" | "legacy" | "committed-frequency" | "none" =
    plannedWorkouts > 0 ? "canonical" : "none";

  // Older programs may not have canonical scheduled-workout instances. Fall
  // back to their dated program days, traversing only this client's preps.
  if (plannedWorkouts === 0) {
    const { data: preps } = await sb
      .from("pl_preps")
      .select("id")
      .eq("client_id", clientId)
      .eq("archived", false);
    const prepIds = (preps ?? []).map((r: any) => r.id);

    if (prepIds.length) {
      const { data: blocks } = await sb
        .from("pl_blocks")
        .select("id")
        .in("prep_id", prepIds)
        .eq("archived", false);
      const blockIds = (blocks ?? []).map((r: any) => r.id);

      if (blockIds.length) {
        const { data: weeks } = await sb
          .from("pl_weeks")
          .select("id")
          .in("block_id", blockIds);
        const weekIds = (weeks ?? []).map((r: any) => r.id);

        if (weekIds.length) {
          const { data: days } = await sb
            .from("pl_days")
            .select("id,scheduled_date")
            .in("week_id", weekIds)
            .gte("scheduled_date", periodStart)
            .lte("scheduled_date", periodEnd);
          plannedWorkouts = new Set((days ?? []).map((r: any) => r.id)).size;
          if (plannedWorkouts > 0) scheduleSource = "legacy";
        }
      }
    }
  }

  // Last-resort context only. We never use this to overwrite a real schedule.
  if (plannedWorkouts === 0 && Number(client.committed_training_frequency) > 0) {
    plannedWorkouts = Number(client.committed_training_frequency);
    scheduleSource = "committed-frequency";
  }

  const weights = (bw ?? []).map((r: any) => ({
    date: r.logged_date,
    value: Number(r.weight_value),
    unit: r.weight_unit,
  }));
  const latest = weights.length ? weights[weights.length - 1] : null;
  const targetUnit = latest?.unit || client.preferred_weight_unit || "lb";

  function averageFor(from: string, to: string): number | null {
    const vals = weights
      .filter((w: any) => w.date >= from && w.date <= to)
      .map((w: any) => normalizeWeight(w.value, w.unit, targetUnit))
      .filter((v: number) => Number.isFinite(v));
    if (!vals.length) return null;
    return Number((vals.reduce((a: number, b: number) => a + b, 0) / vals.length).toFixed(1));
  }

  const currentAvg = averageFor(currentBwStart, bwEnd);
  const previousAvg = averageFor(bwStart, previousBwEnd);
  const avgChange =
    currentAvg != null && previousAvg != null
      ? Number((currentAvg - previousAvg).toFixed(1))
      : null;

  return {
    client_name: client.full_name ?? null,
    checkin_period_start: periodStart,
    checkin_period_end: periodEnd,
    planned_workouts_this_checkin_period: plannedWorkouts || null,
    completed_workouts_this_checkin_period: completedKeys.size,
    workout_adherence_this_checkin_period:
      plannedWorkouts > 0 ? `${completedKeys.size}/${plannedWorkouts}` : null,
    completed_workout_dates_this_checkin_period: Array.from(completedDates).sort(),
    workout_schedule_source: scheduleSource,
    committed_training_days: client.committed_training_days ?? null,
    committed_training_frequency: client.committed_training_frequency ?? null,
    bodyweight_latest: latest,
    bodyweight_7d_average: currentAvg,
    bodyweight_previous_7d_average: previousAvg,
    bodyweight_7d_average_change: avgChange,
    bodyweight_unit: targetUnit,
  };
}

function answerText(taskType: MessengerCheckinTaskType, answers: Record<string, unknown>): string {
  const labels = ANSWER_LABELS[taskType];
  return Object.entries(answers)
    .filter(([, v]) => v !== null && v !== undefined && v !== "" && (!Array.isArray(v) || v.length > 0))
    .map(([k, v]) => `${labels[k] ?? k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
    .join("\n");
}

/** The stand-in recap's summary (older stand-ins carry only this, no `fallback` flag). */
export const FALLBACK_RECAP_SUMMARY = "Client check-in received. Review the answers below before replying.";

/** The stand-in kept while there's no AI recap (flagged, or an older one by its summary). */
export function isStandInRecap(a: any): boolean {
  if (!a || typeof a !== "object") return false;
  return a.fallback === true || String(a.summary ?? "").startsWith(FALLBACK_RECAP_SUMMARY);
}

function fallbackAnalysis(
  taskType: MessengerCheckinTaskType,
  answers: Record<string, any>,
): MessengerCheckinAnalysis {
  const wins: string[] = [];
  const focus: string[] = [];
  const redFlags: string[] = [];
  const goals: string[] = [];

  if (answers.win) wins.push(String(answers.win));
  const ratingPairs =
    taskType === "weekly_checkin"
      ? [
          ["Training", Number(answers.training_rating)],
          ["Nutrition", Number(answers.nutrition_rating)],
        ] as const
      : [
          ["Nutrition", Number(answers.nutrition_rating)],
          ["Training energy", Number(answers.training_energy)],
        ] as const;
  for (const [label, value] of ratingPairs) {
    if (Number.isFinite(value) && value >= 4) wins.push(`${label} was strong.`);
    if (Number.isFinite(value) && value <= 2) focus.push(`${label} needs attention.`);
  }
  const flags = Array.isArray(answers.recovery_flags) ? answers.recovery_flags : [];
  for (const f of flags) {
    if (f !== "All good") focus.push(String(f));
  }
  if (flags.includes("Pain / injury")) {
    redFlags.push(answers.pain_details ? `Pain / injury: ${answers.pain_details}` : "Pain / injury reported.");
  }
  const goal = answers.next_week_goal || answers.goal;
  if (goal) goals.push(String(goal));
  const help = answers.help || answers.hardest || answers.food_changes;
  if (help) focus.push(String(help));

  return {
    // the recap model didn't answer: a stand-in built from their answers (never a reply to send as it is)
    fallback: true,
    summary: FALLBACK_RECAP_SUMMARY,
    wins: wins.slice(0, 3),
    focus: Array.from(new Set(focus)).slice(0, 4),
    goals: goals.slice(0, 3),
    red_flags: redFlags,
    coach_notes: [],
    // never a reply: a templated "good update…" read as the AI's and could be sent as it is
    suggested_response: "",
    urgency: redFlags.length ? "high" : "normal",
  };
}

/** Why a recap couldn't be written, in the coach's words (never the raw API body). */
export type RecapFailure = { kind: string; words: string };

/**
 * A model's recap, or why there isn't one. Every field the card leads with must be the model's
 * own: an answer missing its summary or its reply is a failed recap, never one filled in from
 * the stand-in (a part-template reply once passed for an AI one). Pure.
 */
export function readRecapAnswer(text: string): { analysis: Omit<MessengerCheckinAnalysis, "fallback"> } | { failure: "answer" } {
  const stripped = (text ?? "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  let parsed: any = null;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch {}
    }
  }
  const summary = typeof parsed?.summary === "string" ? parsed.summary.trim() : "";
  const reply = typeof parsed?.suggested_response === "string" ? parsed.suggested_response.trim() : "";
  if (!parsed || typeof parsed !== "object" || !summary || !reply) return { failure: "answer" };
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter((x) => x.trim()).slice(0, 5) : []);
  return {
    analysis: {
      summary,
      wins: list(parsed.wins),
      focus: list(parsed.focus),
      goals: list(parsed.goals),
      red_flags: list(parsed.red_flags),
      coach_notes: list(parsed.coach_notes),
      suggested_response: casualize(reply),
      urgency: ["low", "normal", "high", "urgent"].includes(parsed.urgency) ? parsed.urgency : "normal",
    },
  };
}

async function generateAnalysis(
  sb: any,
  taskType: MessengerCheckinTaskType,
  answers: Record<string, unknown>,
  contextSnapshot: Record<string, unknown>,
  clientId?: string | null,
  programText = "",
  weightText = "",
  painText = "",
  autopilotText = "",
): Promise<{ analysis: MessengerCheckinAnalysis; failure: RecapFailure | null; model: string | null; usage?: { input: number | null; output: number | null } }> {
  const fallback = fallbackAnalysis(taskType, answers as any);
  const { classifyAiError, aiFailureWords } = await import("@/lib/ai/ai-errors");
  try {
    const [{ data: globalCfg }, voice, lifeText] = await Promise.all([
      sb.from("global_ai_config").select("*").limit(1).maybeSingle(),
      // Jared's voice for this client (Admin → My Voice), with his private relationship to them as tone only.
      voicePromptForClient(sb, clientId),
      // their own work & lifestyle profile (client-facing only: the suggested reply is sent to them)
      clientId ? import("@/lib/client-context/load.server").then((m) => m.clientContextText(sb, clientId, "client_facing")).catch(() => null) : Promise.resolve(null),
    ]);
    const { askRoute } = await import("@/lib/ai/route-call.server");

    const system = [
      "You help a strength and nutrition coach review a client check-in.",
      "Use only the supplied answers and app context. Do not invent facts.",
      "Workout counts in APP CONTEXT are authoritative. Never infer a workout count from a 1–5 rating or from qualitative text like 'all my workouts'.",
      "For weekly check-ins, summarize only checkin_period_start through checkin_period_end. Do not use a rolling 7-day interpretation.",
      "If planned_workouts_this_checkin_period and completed_workouts_this_checkin_period are present, use those exact numbers. Never substitute committed_training_frequency for a real scheduled count.",
      "A training_rating of 5 means the client rated training 5/5; it does NOT mean five workouts.",
      "bodyweight_latest versus bodyweight_7d_average is not a trend. Only call weight up/down if bodyweight_7d_average_change is explicitly present.",
      "Be concise and practical. Do not diagnose medical conditions.",
      "A red flag means something the coach should notice or ask about, not a medical diagnosis.",
      "Pain/injury, unusually poor recovery, very low sleep/energy, major adherence problems, or a direct request for help should be surfaced clearly.",
      "The suggested response names one real win, the main focus and 1-2 concrete goals for the new week, and addresses any red flag or request for help.",
      replyLengthRule(taskType === "weekly_checkin" ? "weekly" : "quick"),
      autopilotText ? "AUTOPILOT ASSESSMENT is the coach's decision for this week, made from the same records: the reply agrees with it, never promises a change it doesn't make, and says a proposed change is with the coach." : "",
      globalCfg?.brand_voice ? `BRAND VOICE: ${globalCfg.brand_voice}` : "",
      globalCfg?.tone ? `TONE: ${globalCfg.tone}` : "",
      programText ? PROGRAM_CONTEXT_RULES : "",
      weightText
        ? "WEIGHT MANAGEMENT is computed from their records: use its numbers for bodyweight, cardio, water and digestion, never your own. Don't promise a calorie, cardio or water change: say the coach is looking at it (every change needs the coach's OK). Never suggest dehydration, water loading, sodium tricks or a crash cut. Digestion it flags for a doctor goes in red_flags."
        : "",
      painText ? PAIN_RULES : "",
      painText
        ? "Pain in the suggested response: only when PAIN HISTORY shows something worth saying (recurring, worse, limiting, severe or a warning sign), in a sentence or two, specific to the place and what it came up on, the way the coach talks; nothing for a one-off mild soreness. Anything flagged for the coach also goes in coach_notes."
        : "",
      voice,
      "Return ONLY JSON matching:",
      '{"summary":string,"wins":string[],"focus":string[],"goals":string[],"red_flags":string[],"coach_notes":string[],"suggested_response":string,"urgency":"low"|"normal"|"high"|"urgent"}',
    ].filter(Boolean).join("\n\n");

    // The program goes in as readable lines, not inside the JSON dump.
    const { program: _program, ...appContext } = contextSnapshot as Record<string, unknown>;
    const prompt = [
      `CHECK-IN TYPE: ${TASK_META[taskType].title}`,
      "",
      "CLIENT ANSWERS:",
      answerText(taskType, answers),
      "",
      "APP CONTEXT (supporting context only):",
      JSON.stringify(appContext),
      "",
      ...(programText ? ["PROGRAM CONTEXT:", programText, ""] : []),
      ...(weightText ? [weightText, ""] : []),
      ...(painText ? [painText, ""] : []),
      ...(lifeText ? [lifeText, ""] : []),
      ...(autopilotText ? [autopilotText, ""] : []),
      "Produce a coach-facing recap and suggested reply.",
    ].join("\n");

    // the coach_write route (routing.ts): GPT-5 mini, then GPT-5.5, on the OpenAI key
    const result = await askRoute("coach_write", { system, prompt, timeoutMs: 45_000, tag: "checkin_recap" }, { sb });
    const read = readRecapAnswer(result.text ?? "");
    const usage = { input: result.usage?.input ?? null, output: result.usage?.output ?? null };
    if ("failure" in read) return { analysis: fallback, failure: { kind: "answer", words: aiFailureWords("answer") }, model: result.model, usage };
    // the reply's length and openers, by the same rules as Re-create (autopilot/reply.ts)
    const kind = replyKindFor({
      taskType,
      redFlags: read.analysis.red_flags.length,
      protectedDecision: /PROTECTED|INTERVENE/.test(autopilotText),
      helpAsked: !!String((answers as any).help ?? "").trim(),
    });
    const analysis = { ...read.analysis, suggested_response: fitReply(read.analysis.suggested_response, kind) };
    return { analysis, failure: null, model: result.model, usage };
  } catch (e) {
    const kind = classifyAiError(e);
    return { analysis: fallback, failure: { kind, words: aiFailureWords(kind) }, model: null };
  }
}

export const submitMessengerCheckin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { submissionId: string; answers: Record<string, unknown> }) =>
    z.object({
      submissionId: z.string().uuid(),
      answers: z.record(z.string(), z.unknown()),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = await adminClient();
    const { data: row, error } = await sb
      .from("messenger_checkins")
      .select("*")
      .eq("id", data.submissionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Check-in not found.");

    const actor = await resolveClientAccess(context.supabase, context.userId, row.client_id);
    if (actor !== "client") throw new Error("This check-in must be submitted by the client.");
    if (row.status === "completed") return row;
    if (row.status === "superseded") {
      throw new Error("This check-in was replaced by a newer one — use the latest check-in in your chat.");
    }

    const taskType = row.task_type as MessengerCheckinTaskType;
    const { data: occurrence } = row.occurrence_id
      ? await sb
          .from("client_task_occurrences")
          .select("*")
          .eq("id", row.occurrence_id)
          .maybeSingle()
      : { data: null };
    // Save instantly with the rule-based recap; the AI recap (slow) runs in
    // analyzeMessengerCheckin right after, so the client isn't kept waiting.
    const analysis = fallbackAnalysis(taskType, data.answers as any);
    const now = new Date().toISOString();

    await sb
      .from("messenger_checkins")
      .update({
        answers: data.answers,
        ai_analysis: analysis,
        ai_status: "pending",
        ai_error: null,
        status: "completed",
        submitted_at: now,
        updated_at: now,
      })
      .eq("id", row.id);

    // A check-in sent by hand counts as this week's: it completes the open weekly occurrence
    // due within 3 days either side, so the automated one never follows it.
    let weekOccurrence = occurrence;
    if (!weekOccurrence && taskType === "weekly_checkin") {
      const { data: cl } = await sb.from("clients").select("timezone").eq("id", row.client_id).maybeSingle();
      const today = localDateInTimeZone(cl?.timezone || "America/Winnipeg");
      const { data: open } = await sb
        .from("client_task_occurrences")
        .select("*")
        .eq("client_id", row.client_id)
        .eq("task_type", "weekly_checkin")
        .not("status", "in", "(completed,skipped)")
        .gte("due_local_date", isoDateAdd(today, -3))
        .lte("due_local_date", isoDateAdd(today, 3))
        .order("due_local_date", { ascending: true })
        .limit(1)
        .maybeSingle();
      weekOccurrence = open ?? null;
    }
    if (weekOccurrence && !["completed", "skipped"].includes(weekOccurrence.status)) {
      const occurrence = weekOccurrence;
      await sb
        .from("client_task_occurrences")
        .update({
          status: "completed",
          completed_at: now,
          completed_by: context.userId,
          payload_ref: {
            ...(occurrence.payload_ref ?? {}),
            messenger_checkin_id: row.id,
          },
        })
        .eq("id", occurrence.id);
      try {
        // Seed from just after this occurrence's due time, not from "now".
        // Otherwise an early Friday submission can recreate another check-in
        // for the same Sunday.
        const seedAfter = occurrence?.due_at_utc
          ? new Date(new Date(occurrence.due_at_utc).getTime() + 1000)
          : new Date();
        await ensureNextOccurrence(sb, row.client_id, taskType, seedAfter);
      } catch {
        // Home bootstrap is an idempotent fallback if next-occurrence seeding fails.
      }
    }

    // what they typed under "where does it hurt" goes into the one pain history (pain_reports,
    // read by recovery, the coach's sheet, Cleo and programming) through the same reader as the
    // review's voice. Best effort: a check-in never fails because of it, and its text stays readable.
    if (taskType === "weekly_checkin") {
      try {
        const { checkinPainReports } = await import("@/lib/pain/checkin-pain");
        const { reportsForOlderSchema } = await import("@/lib/pain/report");
        const reports = checkinPainReports((data.answers as any)?.pain_details as string | undefined);
        if (reports.length) {
          let { error: painError } = await sb.rpc("pain_reports_save" as any, { _feedback_id: null, _checkin_id: row.id, _reports: reports } as any);
          if (painError && ["23514", "23502"].includes((painError as any).code)) {
            const older = reportsForOlderSchema(reports);
            if (older.length) ({ error: painError } = await sb.rpc("pain_reports_save" as any, { _feedback_id: null, _checkin_id: row.id, _reports: older } as any));
          }
          if (painError) console.warn("[checkin-pain] not saved", { message: (painError as any).message });
        }
      } catch (e: any) {
        console.warn("[checkin-pain] skipped", { message: e?.message });
      }
    }

    // This month's Nutrition Update answered inside the check-in: the form's submission, and its AI plan queued.
    let nutritionSubmissionId: string | null = null;
    if (taskType === "weekly_checkin") {
      const { foldNutritionUpdate } = await import("@/lib/checkin-coordination/nutrition-fold.server");
      nutritionSubmissionId = await foldNutritionUpdate(sb, row, data.answers as Record<string, unknown>);
      // the one optional profile question it carried: saved to their profile, or rested when skipped
      const { applyCheckinProfileAnswer } = await import("@/lib/checkin-coordination/plan.server");
      await applyCheckinProfileAnswer(sb, row, data.answers as Record<string, unknown>);
    }

    const meta = TASK_META[taskType];
    const { data: sentMessage } = await sb
      .from("messages")
      .insert({
        client_id: row.client_id,
        sender_id: context.userId,
        sender_role: "client",
        body: `${meta.title} complete`,
        attachments: [
          {
            type: "file",
            url: "",
            kind: "checkin_submission",
            checkin_submission_id: row.id,
            checkin_task_type: taskType,
            request_title: meta.title,
          },
        ],
        message_type: "Check-In",
        is_internal_note: false,
        delivery_status: "sent",
        sent_at: now,
        read_by_client_at: now,
      })
      .select("id")
      .single();

    await sb
      .from("conversation_state")
      .upsert(
        {
          client_id: row.client_id,
          status: "needs_response",
          // "Needs Response" is the workflow status (set by the message trigger),
          // not a priority. Only genuinely urgent answers raise priority.
          ...(analysis.urgency === "urgent" || analysis.urgency === "high" ? { priority: "Important" } : {}),
          last_message_at: now,
        },
        { onConflict: "client_id" },
      );

    const { notifyAppEvent } = await import("@/lib/push/app-events.server");
    await notifyAppEvent(sb, "checkin_submitted", {
      clientId: row.client_id,
      sourceId: row.id,
      actorUserId: context.userId,
    });

    return {
      ...row,
      answers: data.answers,
      ai_analysis: analysis,
      ai_status: "pending",
      status: "completed",
      submitted_at: now,
      submission_message_id: sentMessage?.id ?? null,
      nutrition_submission_id: nutritionSubmissionId,
    };
  });


/**
 * AI recap for a submitted check-in. Called right after submit (fire-and-
 * forget) and again from the coach view if it never finished. Idempotent:
 * a finished recap is returned as-is.
 */
export const analyzeMessengerCheckin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { submissionId: string; force?: boolean }) =>
    z.object({ submissionId: z.string().uuid(), force: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = await adminClient();
    const { data: row } = await sb
      .from("messenger_checkins")
      .select("*")
      .eq("id", data.submissionId)
      .maybeSingle();
    if (!row) throw new Error("Check-in not found.");
    const actor = await resolveClientAccess(context.supabase, context.userId, row.client_id);
    if (actor !== "client" && actor !== "admin" && actor !== "coach") throw new Error("Not allowed.");
    // Coaches can re-roll a finished recap ("Redo" on the suggested response).
    const redo = !!data.force && (actor === "admin" || actor === "coach");
    if (row.status !== "completed" || (row.ai_status === "ready" && !redo)) return { status: row.ai_status };

    const out = await recapCheckin(sb, row);
    // "Redo" that couldn't write anything new says so (the recap they had is kept)
    if (out.failure && redo) throw new Error(`Couldn't write a new recap: ${out.failure.words}. Try again in a minute.`);
    return { status: out.status };
  });

/**
 * Writes a submitted check-in's recap (the AI summary and suggested reply) and keeps it on the
 * check-in. When no model answers: a recap they already had is kept as it is (only `ai_error`
 * says the redo failed); a check-in with none gets `ai_status = 'failed'` with why, and the
 * stand-in (their own answers, sorted; never a reply) so the card can say the recap is missing
 * and offer Try again. The ai-health tick redoes failed recaps once AI answers again. Server only.
 */
export async function recapCheckin(sb: any, row: any): Promise<{ status: "ready" | "failed"; failure: RecapFailure | null }> {
  // The check-in and the client's records go to OpenAI only with their permission (5.1.2(i),
  // src/lib/ai-consent): without it there's no recap, and the coach's card says why.
  const { clientAllowsAi } = await import("@/lib/ai-consent/consent.server");
  const consent = await clientAllowsAi(row.client_id);
  if (!consent.ok) {
    const { coachConsentMessage } = await import("@/lib/ai-consent/consent");
    const failure: RecapFailure = { kind: "consent", words: coachConsentMessage(consent.name) };
    const patch = row.ai_status === "ready" ? { ai_error: failure.words } : { ai_status: "failed", ai_error: failure.words };
    await sb.from("messenger_checkins").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", row.id);
    return { status: "failed", failure };
  }
  const taskType = row.task_type as MessengerCheckinTaskType;
  const { data: occurrence } = row.occurrence_id
    ? await sb.from("client_task_occurrences").select("due_local_date, client_tz").eq("id", row.occurrence_id).maybeSingle()
    : { data: null };
  const contextSnapshot = await buildContextSnapshot(sb, row.client_id, {
    dueLocalDate: occurrence?.due_local_date ?? null,
    clientTz: occurrence?.client_tz ?? null,
  });
  // Where they are in the program: the week this check-in covers (middle
  // of its period) and the week coming up.
  const { loadProgramContext } = await import("@/lib/program-context.server");
  const periodStart = (contextSnapshot as any).checkin_period_start as string | undefined;
  const program = await loadProgramContext(sb, row.client_id, periodStart ? isoDateAdd(periodStart, 3) : null);
  const snapshot = { ...contextSnapshot, program: publicProgramContext(program) };
  // Weight management: the deterministic read of their trajectory, cardio, water and
  // digestion, recorded once for the coach (weight_management_reviews, pushed only
  // when it needs them) and handed to the recap so it never contradicts the numbers.
  let weightText = "";
  let autopilotLoaded: any = null;
  if (taskType === "weekly_checkin") {
    const { recordCheckinReview } = await import("@/lib/weight-management/reviews.server");
    const { assessmentText } = await import("@/lib/weight-management/assessment");
    const loaded = await recordCheckinReview(sb, row.client_id, row.id);
    autopilotLoaded = loaded ?? null;
    if (loaded) weightText = assessmentText(loaded.assessment);
    // one coordinated recommendation for the coach (weight management + cardio's recovery read),
    // private to them on this check-in's card; never sent or applied by itself
    try {
      const { recordCheckinRecommendation } = await import("@/lib/coaching-recommendation/record.server");
      await recordCheckinRecommendation(sb, row.client_id, row.id, loaded);
    } catch (err: any) {
      console.error("[checkin] coaching recommendation unavailable", err?.message);
    }
    // the nutrition roadmap reads the new check-in too (a reforecast or adjustment for the coach to approve)
    try {
      const { evaluateRoadmap } = await import("@/lib/nutrition-roadmap/evaluate.server");
      const { roadmapText } = await import("@/lib/nutrition-roadmap/text");
      const e = await evaluateRoadmap(sb, row.client_id, { trigger: "checkin" });
      if (e.loaded.active) weightText = [weightText, roadmapText(e.read, { approved: true })].filter(Boolean).join("\n\n");
    } catch (err: any) {
      console.error("[checkin] nutrition roadmap unavailable", err?.message);
    }
  }
  // Pain over time (src/lib/pain/): what they reported after workouts and in
  // check-ins, what's changing and what lines up with it, with the recovery
  // options their history earns (never one the coach already used recently).
  let painText = "";
  if (taskType === "weekly_checkin") {
    try {
      const { loadPainEntries, loadPainSessions, loadGivenSuggestions, todayIn } = await import("@/lib/pain/load");
      const { buildPainHistory } = await import("@/lib/pain/history");
      const { recoverySuggestions } = await import("@/lib/pain/recovery");
      const { painHistoryForAi } = await import("@/lib/pain/ai");
      const { data: c } = await sb.from("clients").select("timezone").eq("id", row.client_id).maybeSingle();
      const tz = c?.timezone ?? null;
      const [byClient, sessions, given] = await Promise.all([
        loadPainEntries(sb, [row.client_id], { tz: new Map([[row.client_id, tz]]) }),
        loadPainSessions(sb, row.client_id, tz).catch(() => []),
        loadGivenSuggestions(sb, row.client_id),
      ]);
      const history = buildPainHistory(byClient.get(row.client_id) ?? [], todayIn(tz));
      painText = painHistoryForAi(history, { sessions, suggestions: recoverySuggestions(history, sessions, given.given) }) ?? "";
    } catch (e: any) {
      console.error("[checkin] pain history unavailable", e?.message);
    }
  }
  // Cleo Autopilot: the week's one assessment (deterministic), recorded before the reply so the
  // reply is written from the same decision; its drafts are written after the recap (never slowing it)
  let autopilot: { decisionId: string; text: string } | null = null;
  if (taskType === "weekly_checkin") {
    try {
      const { runAssessment } = await import("@/lib/autopilot/run.server");
      const { assessmentForReply } = await import("@/lib/autopilot/assess");
      const r = await runAssessment(sb, row.client_id, { trigger: "checkin", checkinId: row.id, loaded: autopilotLoaded, draft: false });
      if (r) {
        const guard = r.assessment.protections.length ? `\nPROTECTED: ${r.assessment.protections.map((p) => p.text).join("; ")}` : "";
        autopilot = { decisionId: r.decisionId, text: assessmentForReply(r.assessment) + guard };
      }
    } catch (err: any) {
      console.error("[checkin] autopilot assessment unavailable", err?.message);
    }
  }
  const { analysis, failure, model, usage } = await generateAnalysis(sb, taskType, row.answers ?? {}, snapshot, row.client_id, programContextText(program), weightText, painText, autopilot?.text ?? "");
  const had = row.ai_analysis && !isStandInRecap(row.ai_analysis) ? row.ai_analysis : null;
  if (failure && had) {
    // a Redo that failed never replaces a real recap with the stand-in
    await sb.from("messenger_checkins").update({ ai_error: failure.words, updated_at: new Date().toISOString() }).eq("id", row.id);
    return { status: "ready", failure };
  }
  await sb
    .from("messenger_checkins")
    .update({
      context_snapshot: snapshot,
      ai_analysis: analysis,
      ai_status: failure ? "failed" : "ready",
      ai_error: failure ? failure.words : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (analysis.urgency === "urgent" || analysis.urgency === "high") {
    await sb
      .from("conversation_state")
      .upsert({ client_id: row.client_id, priority: "Important" }, { onConflict: "client_id" });
  }
  if (taskType === "weekly_checkin") {
    try {
      const { recordReplyVersion } = await import("@/lib/autopilot/reply.server");
      if (!failure && analysis.suggested_response) {
        await recordReplyVersion(sb, { clientId: row.client_id, checkinId: row.id, decisionId: autopilot?.decisionId ?? null, body: analysis.suggested_response, style: "initial", model, usage: usage ?? null, userId: null });
      }
      if (autopilot) {
        const { createDrafts } = await import("@/lib/autopilot/run.server");
        await createDrafts(sb, autopilot.decisionId);
      }
    } catch (err: any) {
      console.error("[checkin] autopilot drafts unavailable", err?.message);
    }
  }
  return failure ? { status: "failed", failure } : { status: "ready", failure: null };
}


/**
 * The check-in's plan (what this week adds, and what it skipped and why):
 * worked out once from their records and kept on the check-in
 * (checkin-coordination/plan.ts). The client and their coach both read it.
 */
export const getCheckinPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { submissionId: string }) => z.object({ submissionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = await adminClient();
    const { data: row } = await sb.from("messenger_checkins").select("id, client_id, status, plan, created_at, occurrence_id, task_type, nutrition_requested_at").eq("id", data.submissionId).maybeSingle();
    if (!row) throw new Error("Check-in not found.");
    await resolveClientAccess(context.supabase, context.userId, row.client_id);
    if (row.task_type !== "weekly_checkin") return { plan: null };
    const { ensureCheckinPlan } = await import("@/lib/checkin-coordination/plan.server");
    return { plan: await ensureCheckinPlan(sb, row) };
  });

/**
 * What's already out for a client, for the coach's send dialog: an open weekly
 * check-in, when the next automated one goes, and a Nutrition Update still
 * waiting. The dialog warns; sending by hand is always the coach's call.
 */
export const getRequestStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string }) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await resolveClientAccess(context.supabase, context.userId, data.clientId);
    if (actor === "client") throw new Error("Coach access required.");
    const sb = await adminClient();
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [{ data: pending }, { data: occ }, { NUTRITION_REQUEST_FORM_ID }] = await Promise.all([
      sb.from("messenger_checkins").select("created_at").eq("client_id", data.clientId).eq("task_type", "weekly_checkin").eq("status", "pending").gte("created_at", since).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("client_task_occurrences").select("id, due_local_date").eq("client_id", data.clientId).eq("task_type", "weekly_checkin").not("status", "in", "(completed,skipped)").order("due_local_date", { ascending: true }).limit(1).maybeSingle(),
      import("@/lib/nutrition-request"),
    ]);
    let nextAutomated: string | null = null;
    if (occ?.due_local_date) {
      const { data: carded } = await sb.from("messenger_checkins").select("id").eq("occurrence_id", occ.id).maybeSingle();
      // the card goes out 2 days before it's due (Friday for a Sunday check-in)
      if (!carded) nextAutomated = isoDateAdd(String(occ.due_local_date).slice(0, 10), -2);
    }
    const { data: asked } = await sb
      .from("messages")
      .select("created_at")
      .eq("client_id", data.clientId)
      .gte("created_at", new Date(Date.now() - 14 * 86_400_000).toISOString())
      .contains("attachments", JSON.stringify([{ kind: "form_request", form_id: NUTRITION_REQUEST_FORM_ID }]))
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    let nutritionPending: string | null = null;
    if (asked?.created_at) {
      const { data: answered } = await sb.from("nf_submissions").select("id").eq("client_id", data.clientId).eq("form_id", NUTRITION_REQUEST_FORM_ID).neq("status", "in_progress").gte("submitted_at", asked.created_at).limit(1);
      if (!(answered ?? []).length) nutritionPending = String(asked.created_at).slice(0, 10);
    }
    return {
      today: localDateInTimeZone("America/Winnipeg"),
      status: { weekly: { pendingSince: pending?.created_at ? String(pending.created_at).slice(0, 10) : null, nextAutomated }, nutrition: { pendingSince: nutritionPending } },
    };
  });
