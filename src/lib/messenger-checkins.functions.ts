import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ensureNextOccurrence } from "@/lib/action-centre.functions";

export type MessengerCheckinTaskType = "weekly_checkin" | "nutrition_review";

export type MessengerCheckinAnalysis = {
  summary: string;
  wins: string[];
  focus: string[];
  goals: string[];
  red_flags: string[];
  coach_notes: string[];
  suggested_response: string;
  urgency: "low" | "normal" | "high" | "urgent";
};

const taskSchema = z.enum(["weekly_checkin", "nutrition_review"]);

const ANSWER_LABELS: Record<MessengerCheckinTaskType, Record<string, string>> = {
  weekly_checkin: {
    week_rating: "Overall week",
    training_rating: "Training rating (1–5)",
    nutrition_rating: "Nutrition consistency rating (1–5)",
    recovery_flags: "Recovery / issues",
    pain_details: "Pain / injury details",
    win: "Biggest win",
    help: "Help or changes needed",
    next_week_goal: "Main goal for next week",
  },
  nutrition_review: {
    nutrition_rating: "Nutrition consistency rating (1–5)",
    hunger: "Hunger / appetite",
    digestion: "Digestion",
    training_energy: "Energy around training rating (1–5)",
    hardest: "Hardest nutrition issue",
    food_changes: "Foods / meals to change",
    goal: "Nutrition goal until next review",
  },
};

const TASK_META: Record<MessengerCheckinTaskType, { title: string; body: string }> = {
  weekly_checkin: {
    title: "Weekly Check-In",
    body: "Weekly check-in reminder — quick update so we can set the right focus for the new week.",
  },
  nutrition_review: {
    title: "Nutrition Review",
    body: "Nutrition review reminder — quick update so I can adjust anything that needs it.",
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

    const actor = await resolveClientAccess(context.supabase, context.userId, clientId);
    if (actor !== "client" && actor !== "admin" && actor !== "coach") {
      return { ok: false as const, created: 0 };
    }

    const sb = await adminClient();
    const { data: occurrences } = await sb
      .from("client_task_occurrences")
      .select("id,task_type,due_local_date,client_tz,status")
      .eq("client_id", clientId)
      .in("task_type", ["weekly_checkin", "nutrition_review"])
      .not("status", "in", "(completed,skipped)")
      .order("due_at_utc", { ascending: true })
      .limit(8);

    let created = 0;
    for (const occ of occurrences ?? []) {
      const taskType = occ.task_type as MessengerCheckinTaskType;
      const today = localDateInTimeZone(occ.client_tz || "UTC");
      const daysUntil = dayDiff(today, occ.due_local_date);
      // Never backfill old/overdue requests. Weekly check-ins surface one day
      // before they are due; nutrition reviews surface on the due date.
      const dueNow =
        taskType === "weekly_checkin"
          ? daysUntil >= 0 && daysUntil <= 1
          : daysUntil === 0;
      if (!dueNow) continue;

      const { data: existing } = await sb
        .from("messenger_checkins")
        .select("id")
        .eq("occurrence_id", occ.id)
        .maybeSingle();
      if (existing) continue;

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
    return createRequest(sb, {
      clientId: data.clientId,
      taskType: data.taskType,
      senderId: context.userId,
      note: data.note ?? null,
    });
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
  const periodEnd =
    opts?.dueLocalDate ||
    localDateInTimeZone(opts?.clientTz || client.timezone || "UTC");
  const periodStart = isoWeekMonday(periodEnd);

  const bwStart = isoDateAdd(periodEnd, -13);
  const currentBwStart = isoDateAdd(periodEnd, -6);
  const previousBwEnd = isoDateAdd(periodEnd, -7);

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
      .lte("logged_date", periodEnd)
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

  const scheduledDateById = new Map(
    (completionSchedules ?? []).map((r: any) => [r.id, r.scheduled_date]),
  );
  const dayDateById = new Map(
    (completionDays ?? []).map((r: any) => [r.id, r.scheduled_date]),
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

  const currentAvg = averageFor(currentBwStart, periodEnd);
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
    summary: "Client check-in received. Review the answers below before replying.",
    wins: wins.slice(0, 3),
    focus: Array.from(new Set(focus)).slice(0, 4),
    goals: goals.slice(0, 3),
    red_flags: redFlags,
    coach_notes: [],
    suggested_response: goal
      ? `good update. main focus this week is ${String(goal)}. keep me posted if anything changes and we’ll adjust fast.`
      : "good update. keep the basics tight this week and let me know early if anything needs adjusted.",
    urgency: redFlags.length ? "high" : "normal",
  };
}

async function generateAnalysis(
  sb: any,
  taskType: MessengerCheckinTaskType,
  answers: Record<string, unknown>,
  contextSnapshot: Record<string, unknown>,
): Promise<MessengerCheckinAnalysis> {
  const fallback = fallbackAnalysis(taskType, answers as any);
  try {
    const [{ data: globalCfg }] = await Promise.all([
      sb.from("global_ai_config").select("*").limit(1).maybeSingle(),
    ]);
    const { createLovableAiGateway, DEFAULT_AI_MODEL } = await import("@/lib/ai-gateway.server");
    const { generateText } = await import("ai");
    const gateway = createLovableAiGateway();
    const modelId = globalCfg?.default_model || DEFAULT_AI_MODEL;

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
      "The suggested response must sound human, direct and short. It should acknowledge a win, name the main focus, give 1-3 concrete goals for the new week, and address any red flag or request for help.",
      globalCfg?.brand_voice ? `BRAND VOICE: ${globalCfg.brand_voice}` : "",
      globalCfg?.tone ? `TONE: ${globalCfg.tone}` : "",
      "Return ONLY JSON matching:",
      '{"summary":string,"wins":string[],"focus":string[],"goals":string[],"red_flags":string[],"coach_notes":string[],"suggested_response":string,"urgency":"low"|"normal"|"high"|"urgent"}',
    ].filter(Boolean).join("\n\n");

    const prompt = [
      `CHECK-IN TYPE: ${TASK_META[taskType].title}`,
      "",
      "CLIENT ANSWERS:",
      answerText(taskType, answers),
      "",
      "APP CONTEXT (supporting context only):",
      JSON.stringify(contextSnapshot),
      "",
      "Produce a coach-facing recap and suggested reply.",
    ].join("\n");

    const result = await generateText({
      model: gateway(modelId),
      system,
      prompt,
    });
    const stripped = (result.text ?? "")
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
    if (!parsed || typeof parsed !== "object") return fallback;
    return {
      summary: String(parsed.summary ?? fallback.summary),
      wins: Array.isArray(parsed.wins) ? parsed.wins.map(String).slice(0, 5) : fallback.wins,
      focus: Array.isArray(parsed.focus) ? parsed.focus.map(String).slice(0, 5) : fallback.focus,
      goals: Array.isArray(parsed.goals) ? parsed.goals.map(String).slice(0, 5) : fallback.goals,
      red_flags: Array.isArray(parsed.red_flags) ? parsed.red_flags.map(String).slice(0, 5) : fallback.red_flags,
      coach_notes: Array.isArray(parsed.coach_notes) ? parsed.coach_notes.map(String).slice(0, 5) : [],
      suggested_response: String(parsed.suggested_response ?? fallback.suggested_response),
      urgency: ["low", "normal", "high", "urgent"].includes(parsed.urgency)
        ? parsed.urgency
        : fallback.urgency,
    };
  } catch {
    return fallback;
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

    const taskType = row.task_type as MessengerCheckinTaskType;
    const { data: occurrence } = row.occurrence_id
      ? await sb
          .from("client_task_occurrences")
          .select("*")
          .eq("id", row.occurrence_id)
          .maybeSingle()
      : { data: null };
    const contextSnapshot = await buildContextSnapshot(sb, row.client_id, {
      dueLocalDate: occurrence?.due_local_date ?? null,
      clientTz: occurrence?.client_tz ?? null,
    });
    const analysis = await generateAnalysis(sb, taskType, data.answers, contextSnapshot);
    const now = new Date().toISOString();

    await sb
      .from("messenger_checkins")
      .update({
        answers: data.answers,
        context_snapshot: contextSnapshot,
        ai_analysis: analysis,
        ai_status: "ready",
        ai_error: null,
        status: "completed",
        submitted_at: now,
        updated_at: now,
      })
      .eq("id", row.id);

    if (occurrence && !["completed", "skipped"].includes(occurrence.status)) {
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
        .eq("id", row.occurrence_id);
      try {
        await ensureNextOccurrence(sb, row.client_id, taskType, new Date());
      } catch {
        // Home bootstrap is an idempotent fallback if next-occurrence seeding fails.
      }
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
          priority: analysis.urgency === "urgent" || analysis.urgency === "high"
            ? "Important"
            : "Needs Response",
          last_message_at: now,
        },
        { onConflict: "client_id" },
      );

    return {
      ...row,
      answers: data.answers,
      context_snapshot: contextSnapshot,
      ai_analysis: analysis,
      ai_status: "ready",
      status: "completed",
      submitted_at: now,
      submission_message_id: sentMessage?.id ?? null,
    };
  });
