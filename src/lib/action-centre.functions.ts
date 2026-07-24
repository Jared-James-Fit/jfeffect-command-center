import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============================================================
// Types
// ============================================================

export type TaskType =
  | "weekly_checkin"
  | "nutrition_review"
  | "progress_photos"
  | "monthly_assessment"
  | "bodyweight"
  | "technique_review"
  | "custom_form";

export type EffectiveSchedule = {
  task_type: string;
  title: string;
  enabled: boolean;
  frequency: "weekly" | "biweekly" | "monthly" | "custom_days" | "daily" | "manual";
  interval_days: number | null;
  due_day_of_week: number | null;
  due_time_local: string;
  tz_mode: "client" | "coach" | "fixed";
  fixed_tz: string | null;
  reminder_offsets: number[];
  overdue_after_days: number | null;
  reminder_after_days: number | null;
  form_id: string | null;
  source_definition_id: string | null;
  source_override_id: string | null;
};

export type StatusChip = {
  label: string;
  tone: "success" | "warning" | "danger" | "info" | "muted";
};

export type ActionCentreItem = {
  id: string;
  client_id: string;
  task_type: string;
  title: string;
  subtitle: string | null;
  due_at_utc: string;
  due_local_date: string;
  client_tz: string;
  status: string;
  is_coach_requested: boolean;
  chip: StatusChip;
  priority: number;
  metadata: Record<string, string | number | boolean | null>;
};

// ============================================================
// Time-zone helpers (Intl-based; no extra deps)
// ============================================================

function partsInTz(date: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) map[p.type] = p.value;
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour === "24" ? "0" : map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: weekdayMap[map.weekday] ?? 0,
  };
}

function zonedLocalToUtc(y: number, m: number, d: number, hh: number, mm: number, ss: number, tz: string): Date {
  const utcGuess = Date.UTC(y, m - 1, d, hh, mm, ss);
  const parts = partsInTz(new Date(utcGuess), tz);
  const asUtcParts = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const offsetMs = asUtcParts - utcGuess;
  return new Date(utcGuess - offsetMs);
}

function isoLocalDate(y: number, m: number, d: number) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${y}-${p(m)}-${p(d)}`;
}

function parseTime(hhmm: string): [number, number, number] {
  const [h = "0", m = "0", s = "0"] = hhmm.split(":");
  return [Number(h) || 0, Number(m) || 0, Number(s) || 0];
}

function addDays(y: number, m: number, d: number, days: number) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

// ============================================================
// Effective schedule (override → definition)
// ============================================================

async function loadEffectiveSchedule(
  supabase: any,
  clientId: string,
  taskType: string,
): Promise<EffectiveSchedule | null> {
  const [{ data: def }, { data: ovr }] = await Promise.all([
    supabase.from("coach_task_definitions").select("*").eq("task_type", taskType).maybeSingle(),
    supabase.from("client_task_overrides").select("*").eq("client_id", clientId).eq("task_type", taskType).maybeSingle(),
  ]);
  if (!def && !ovr) return null;
  const pick = (key: string) =>
    ovr && (ovr as any)[key] !== null && (ovr as any)[key] !== undefined
      ? (ovr as any)[key]
      : def
        ? (def as any)[key]
        : null;
  return {
    task_type: taskType,
    title: def?.title ?? taskType,
    enabled: pick("enabled") ?? true,
    frequency: pick("frequency") ?? "weekly",
    interval_days: pick("interval_days"),
    due_day_of_week: pick("due_day_of_week"),
    due_time_local: pick("due_time_local") ?? "23:59",
    tz_mode: pick("tz_mode") ?? "client",
    fixed_tz: pick("fixed_tz"),
    reminder_offsets: pick("reminder_offsets") ?? [],
    overdue_after_days: pick("overdue_after_days"),
    reminder_after_days: pick("reminder_after_days"),
    form_id: def?.form_id ?? null,
    source_definition_id: def?.id ?? null,
    source_override_id: ovr?.id ?? null,
  };
}

async function resolveClientTz(supabase: any, clientId: string, sched: EffectiveSchedule): Promise<string> {
  if (sched.tz_mode === "fixed" && sched.fixed_tz) return sched.fixed_tz;
  if (sched.tz_mode === "coach") return "UTC";
  const { data } = await supabase.from("clients").select("timezone").eq("id", clientId).maybeSingle();
  return ((data as any)?.timezone as string | null) || "UTC";
}

// ============================================================
// Next-occurrence computation
// ============================================================

function computeNextDueUtc(
  sched: EffectiveSchedule,
  tz: string,
  after: Date,
): { dueAtUtc: Date; localDate: string } | null {
  if (!sched.enabled || sched.frequency === "manual") return null;
  const [hh, mm, ss] = parseTime(sched.due_time_local);
  const nowParts = partsInTz(after, tz);
  const { year: y, month: m, day: d, weekday } = nowParts;

  if (sched.frequency === "daily") {
    const todayDue = zonedLocalToUtc(y, m, d, hh, mm, ss, tz);
    if (todayDue > after) return { dueAtUtc: todayDue, localDate: isoLocalDate(y, m, d) };
    const next = addDays(y, m, d, 1);
    return { dueAtUtc: zonedLocalToUtc(next.y, next.m, next.d, hh, mm, ss, tz), localDate: isoLocalDate(next.y, next.m, next.d) };
  }

  if (sched.frequency === "weekly" || sched.frequency === "biweekly") {
    const targetDow = sched.due_day_of_week ?? 6;
    let deltaDays = (targetDow - weekday + 7) % 7;
    if (deltaDays === 0) {
      const todayDue = zonedLocalToUtc(y, m, d, hh, mm, ss, tz);
      if (todayDue <= after) deltaDays = sched.frequency === "biweekly" ? 14 : 7;
    }
    const next = addDays(y, m, d, deltaDays);
    return { dueAtUtc: zonedLocalToUtc(next.y, next.m, next.d, hh, mm, ss, tz), localDate: isoLocalDate(next.y, next.m, next.d) };
  }

  if (sched.frequency === "monthly") {
    const nextMonth = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
    return {
      dueAtUtc: zonedLocalToUtc(nextMonth.y, nextMonth.m, d, hh, mm, ss, tz),
      localDate: isoLocalDate(nextMonth.y, nextMonth.m, d),
    };
  }

  if (sched.frequency === "custom_days") {
    const interval = sched.interval_days ?? 7;
    const next = addDays(y, m, d, interval);
    return {
      dueAtUtc: zonedLocalToUtc(next.y, next.m, next.d, hh, mm, ss, tz),
      localDate: isoLocalDate(next.y, next.m, next.d),
    };
  }

  return null;
}

// ============================================================
// Status chip labels
// ============================================================

function chipForOccurrence(occ: { due_local_date: string; status: string; client_tz: string }, nowUtc: Date): StatusChip {
  if (occ.status === "completed") return { label: "Completed", tone: "success" };
  const nowLocalParts = partsInTz(nowUtc, occ.client_tz);
  const today = isoLocalDate(nowLocalParts.year, nowLocalParts.month, nowLocalParts.day);
  const [dy, dm, dd] = occ.due_local_date.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  const diffDays = Math.round((Date.UTC(dy, dm - 1, dd) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
  if (diffDays === 0) return { label: "Due Today", tone: "warning" };
  if (diffDays === 1) return { label: "Due Tomorrow", tone: "info" };
  if (diffDays > 1) return { label: `Due in ${diffDays} Days`, tone: "info" };
  const overdue = Math.abs(diffDays);
  if (overdue === 1) return { label: "1 Day Overdue", tone: "danger" };
  if (overdue < 7) return { label: `${overdue} Days Overdue`, tone: "danger" };
  const weeks = Math.floor(overdue / 7);
  return { label: weeks === 1 ? "1 Week Overdue" : `${weeks} Weeks Overdue`, tone: "danger" };
}

// ============================================================
// Public server functions
// ============================================================

export const getEffectiveSchedule = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string; taskType: string }) => d)
  .handler(async ({ data, context }) => {
    return loadEffectiveSchedule(context.supabase, data.clientId, data.taskType);
  });

export const listActionCentre = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId?: string }) => d)
  .handler(async ({ data, context }): Promise<ActionCentreItem[]> => {
    let clientId = data.clientId;
    if (!clientId) {
      const { data: c } = await context.supabase.from("clients").select("id").eq("user_id", context.userId).maybeSingle();
      clientId = c?.id;
    }
    if (!clientId) return [];

    const { data: rows, error } = await context.supabase
      .from("client_task_occurrences")
      .select("id, client_id, task_type, title, subtitle, due_at_utc, due_local_date, client_tz, status, is_coach_requested, priority, metadata")
      .eq("client_id", clientId)
      .not("status", "in", "(completed,skipped)")
      .order("due_at_utc", { ascending: true })
      .limit(50);
    if (error) throw new Error(error.message);

    const now = new Date();
    const items = (rows ?? []).map((r: any) => ({ ...r, chip: chipForOccurrence(r, now) })) as ActionCentreItem[];

    return items.sort((a, b) => {
      const rank = (it: ActionCentreItem) => {
        if (it.is_coach_requested && it.chip.tone === "danger") return 0;
        if (it.chip.tone === "danger") return 1;
        if (it.chip.label === "Due Today") return 2;
        if (it.chip.label === "Due Tomorrow") return 3;
        return 4 + it.priority / 100;
      };
      const ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      return a.due_at_utc.localeCompare(b.due_at_utc);
    });
  });

async function ensureNextOccurrence(
  supabase: any,
  clientId: string,
  taskType: string,
  after: Date,
): Promise<void> {
  const sched = await loadEffectiveSchedule(supabase, clientId, taskType);
  if (!sched || !sched.enabled || sched.frequency === "manual") return;
  const tz = await resolveClientTz(supabase, clientId, sched);
  const next = computeNextDueUtc(sched, tz, after);
  if (!next) return;
  // Occurrence generation is a system-side write (client role has no INSERT
  // policy on client_task_occurrences). Use the admin client so bootstrap /
  // completion flows can seed the next row regardless of the caller.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("client_task_occurrences").insert({
    client_id: clientId,
    task_type: taskType,
    title: sched.title,
    due_at_utc: next.dueAtUtc.toISOString(),
    due_local_date: next.localDate,
    client_tz: tz,
    status: "upcoming",
    source_definition_id: sched.source_definition_id,
    source_override_id: sched.source_override_id,
  });
  if (error && (error as any).code !== "23505") {
    console.error("[action-centre] ensureNextOccurrence insert failed", { taskType, error });
  }
}

export const completeTaskOccurrence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { occurrenceId: string; payloadRef?: Record<string, unknown> }) => d)
  .handler(async ({ data, context }) => {
    const { data: occRaw, error } = await context.supabase
      .from("client_task_occurrences")
      .select("*")
      .eq("id", data.occurrenceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!occRaw) throw new Error("Occurrence not found");
    const occ = occRaw as any;

    const { error: upErr } = await context.supabase
      .from("client_task_occurrences")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        completed_by: context.userId,
        payload_ref: { ...(occ.payload_ref ?? {}), ...(data.payloadRef ?? {}) },
      })
      .eq("id", data.occurrenceId);
    if (upErr) throw new Error(upErr.message);

    await ensureNextOccurrence(context.supabase, occ.client_id, occ.task_type, new Date());
    return { ok: true };
  });

export const generateNextOccurrence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string; taskType: string }) => d)
  .handler(async ({ data, context }) => {
    await ensureNextOccurrence(context.supabase, data.clientId, data.taskType, new Date());
    return { ok: true };
  });

/**
 * Bootstrap: for the current user's client, ensure every enabled task
 * definition has at least one active (non-completed) occurrence. Safe to call
 * on every portal load — inserts are guarded by the unique partial index on
 * (client_id, task_type, due_local_date) for non-completed rows.
 */
export const bootstrapClientOccurrences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId?: string }) => d)
  .handler(async ({ data, context }) => {
    let clientId = data.clientId;
    if (!clientId) {
      const { data: c } = await context.supabase
        .from("clients").select("id").eq("user_id", context.userId).maybeSingle();
      clientId = (c as any)?.id;
    }
    if (!clientId) return { ok: false, reason: "no_client" as const };

    const { data: defs } = await context.supabase
      .from("coach_task_definitions").select("task_type, enabled").eq("enabled", true);
    const { data: existing } = await context.supabase
      .from("client_task_occurrences")
      .select("task_type")
      .eq("client_id", clientId)
      .not("status", "in", "(completed,skipped)");
    const have = new Set((existing ?? []).map((r: any) => r.task_type));
    const now = new Date();
    for (const d of (defs ?? []) as any[]) {
      if (have.has(d.task_type)) continue;
      await ensureNextOccurrence(context.supabase, clientId, d.task_type, now);
    }
    return { ok: true };
  });
export const setClientTimeZone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { timeZone: string }) => z.object({ timeZone: z.string().min(1).max(64) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: c } = await context.supabase.from("clients").select("id, timezone").eq("user_id", context.userId).maybeSingle();
    const row = c as any;
    if (!row) return { ok: false, reason: "no_client" as const, unchanged: false };
    if (row.timezone === data.timeZone) return { ok: true, reason: null, unchanged: true };
    await context.supabase.from("clients").update({ timezone: data.timeZone }).eq("id", row.id);
    return { ok: true, reason: null, unchanged: false };
  });

// ============================================================
// Admin scheduling (Phase 3)
// RLS on coach_task_definitions / client_task_overrides restricts writes to
// admins via public.has_role; these fns act as the signed-in user, so
// non-admins are rejected at the DB layer.
// ============================================================

export type TaskDefinition = {
  id: string;
  task_type: string;
  title: string;
  enabled: boolean;
  frequency: "weekly" | "biweekly" | "monthly" | "custom_days" | "daily" | "manual";
  interval_days: number | null;
  due_day_of_week: number | null;
  due_time_local: string;
  tz_mode: "client" | "coach" | "fixed";
  fixed_tz: string | null;
  reminder_offsets: number[];
  overdue_after_days: number | null;
  reminder_after_days: number | null;
  form_id: string | null;
};

export type TaskOverride = {
  id: string;
  client_id: string;
  task_type: string;
  enabled: boolean | null;
  frequency: string | null;
  interval_days: number | null;
  due_day_of_week: number | null;
  due_time_local: string | null;
  tz_mode: string | null;
  fixed_tz: string | null;
  reminder_offsets: number[] | null;
  overdue_after_days: number | null;
  reminder_after_days: number | null;
};

export const listTaskDefinitions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TaskDefinition[]> => {
    const { data, error } = await context.supabase
      .from("coach_task_definitions")
      .select("*")
      .order("task_type", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as TaskDefinition[];
  });

const definitionPatchSchema = z.object({
  task_type: z.string().min(1).max(64),
  title: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  frequency: z.enum(["weekly", "biweekly", "monthly", "custom_days", "daily", "manual"]).optional(),
  interval_days: z.number().int().min(1).max(365).nullable().optional(),
  due_day_of_week: z.number().int().min(0).max(6).nullable().optional(),
  due_time_local: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  tz_mode: z.enum(["client", "coach", "fixed"]).optional(),
  fixed_tz: z.string().max(64).nullable().optional(),
  reminder_offsets: z.array(z.number().int().min(-30).max(30)).optional(),
  overdue_after_days: z.number().int().min(0).max(60).nullable().optional(),
  reminder_after_days: z.number().int().min(0).max(60).nullable().optional(),
});

export const upsertTaskDefinition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => definitionPatchSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { task_type, ...patch } = data;
    const { data: existing } = await context.supabase
      .from("coach_task_definitions").select("id").eq("task_type", task_type).maybeSingle();
    if (existing) {
      const { error } = await context.supabase
        .from("coach_task_definitions")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("task_type", task_type);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await context.supabase
        .from("coach_task_definitions")
        .insert({ task_type, title: patch.title ?? task_type, ...patch });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const listClientOverrides = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string }) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<TaskOverride[]> => {
    const { data: rows, error } = await context.supabase
      .from("client_task_overrides")
      .select("*")
      .eq("client_id", data.clientId);
    if (error) throw new Error(error.message);
    return (rows ?? []) as TaskOverride[];
  });

const overridePatchSchema = z.object({
  clientId: z.string().uuid(),
  task_type: z.string().min(1).max(64),
  enabled: z.boolean().nullable().optional(),
  frequency: z.enum(["weekly", "biweekly", "monthly", "custom_days", "daily", "manual"]).nullable().optional(),
  interval_days: z.number().int().min(1).max(365).nullable().optional(),
  due_day_of_week: z.number().int().min(0).max(6).nullable().optional(),
  due_time_local: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
  tz_mode: z.enum(["client", "coach", "fixed"]).nullable().optional(),
  fixed_tz: z.string().max(64).nullable().optional(),
  reminder_offsets: z.array(z.number().int().min(-30).max(30)).nullable().optional(),
});

export const upsertTaskOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => overridePatchSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { clientId, task_type, ...patch } = data;
    const { data: existing } = await context.supabase
      .from("client_task_overrides").select("id")
      .eq("client_id", clientId).eq("task_type", task_type).maybeSingle();
    if (existing) {
      const { error } = await context.supabase
        .from("client_task_overrides")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("client_id", clientId).eq("task_type", task_type);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await context.supabase
        .from("client_task_overrides")
        .insert({ client_id: clientId, task_type, ...patch });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const resetTaskOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string; task_type: string }) =>
    z.object({ clientId: z.string().uuid(), task_type: z.string().min(1).max(64) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("client_task_overrides")
      .delete()
      .eq("client_id", data.clientId).eq("task_type", data.task_type);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
