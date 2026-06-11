import { supabase } from "@/integrations/supabase/client";
import { addDays, format, parseISO } from "date-fns";
import { WEEK_DAYS, type WeekDay } from "@/lib/training-schedule";

const sb = supabase as any;

const WEEKDAY_INDEX: Record<WeekDay, number> = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  Sunday: 0,
};

export type CardioAssignment = {
  targetId: string;
  label: string;
  dayType: string;
};

export type PreviewRow = {
  dayId: string;
  weekId: string;
  weekIndex: number;
  dayIndex: number;
  title: string;
  focus: string | null;
  dateISO: string | null;
  weekday: WeekDay | null;
  dayType: "Training" | "Rest" | "High";
  cardio: CardioAssignment[];
  manualOverride: boolean;
  warnings: string[];
};

export type SchedulePreview = {
  rows: PreviewRow[];
  blockWarnings: string[];
  availabilityUsed: string[];
  clientId: string;
  blockStartISO: string | null;
};

function resolveAvailabilityPool(client: any): WeekDay[] {
  const committed: string[] = client.committed_training_days ?? [];
  const available: string[] = client.available_training_days ?? [];
  const preferred: string[] = client.preferred_training_days ?? [];
  const unavailable: string[] = client.unavailable_training_days ?? [];
  const unset = new Set(unavailable);
  const pool = new Set<string>([...committed, ...available]);
  let result = [...pool].filter((d) => !unset.has(d));
  if (result.length === 0) {
    result = preferred.filter((d) => !unset.has(d));
  }
  // Order by week start (Monday → Sunday)
  return WEEK_DAYS.filter((d) => result.includes(d));
}

function dateForWeekday(weekStart: Date, weekday: WeekDay): Date {
  const startDow = weekStart.getDay(); // 0..6
  const targetDow = WEEKDAY_INDEX[weekday];
  // Treat week as Monday-first
  const startOffset = (startDow + 6) % 7; // distance from Monday
  const targetOffset = (targetDow + 6) % 7;
  return addDays(weekStart, targetOffset - startOffset);
}

function classifyDayType(focus: string | null | undefined): "Training" | "Rest" | "High" {
  const f = (focus ?? "").toLowerCase();
  if (f.includes("high")) return "High";
  return "Training";
}

export async function buildSchedulePreview(blockId: string): Promise<SchedulePreview> {
  const { data: block } = await sb
    .from("pl_blocks")
    .select("id, client_id, start_date, weeks, week_duration_days")
    .eq("id", blockId)
    .maybeSingle();
  if (!block) {
    return { rows: [], blockWarnings: ["Block not found."], availabilityUsed: [], clientId: "", blockStartISO: null };
  }

  const [{ data: client }, { data: weeks }, { data: cardio }] = await Promise.all([
    sb
      .from("clients")
      .select(
        "id, committed_training_days, available_training_days, preferred_training_days, unavailable_training_days",
      )
      .eq("id", block.client_id)
      .maybeSingle(),
    sb.from("pl_weeks").select("id, week_index").eq("block_id", blockId).order("week_index"),
    sb
      .from("cardio_targets")
      .select("id, day_type, custom_day_type, frequency_per_week, cardio_type, custom_type, status, visible_to_client, enabled")
      .eq("client_id", block.client_id),
  ]);

  const weekRows = (weeks ?? []) as Array<{ id: string; week_index: number }>;
  const weekIds = weekRows.map((w) => w.id);
  const { data: days } = weekIds.length
    ? await sb
        .from("pl_days")
        .select("id, week_id, day_index, title, focus, scheduled_date, schedule_locked")
        .in("week_id", weekIds)
        .order("day_index")
    : { data: [] as any[] };

  const pool = resolveAvailabilityPool(client ?? {});
  const activeCardio = (cardio ?? []).filter(
    (c: any) => c.enabled !== false && c.visible_to_client !== false && (c.status ?? "Active") === "Active",
  );

  const blockWarnings: string[] = [];
  if (!block.start_date) blockWarnings.push("Block has no start date. Set start date before scheduling.");
  if (pool.length === 0) blockWarnings.push("Client has no available training days.");

  // detect workouts-per-week vs available days
  const daysByWeek = new Map<string, any[]>();
  for (const d of (days ?? []) as any[]) {
    const list = daysByWeek.get(d.week_id) ?? [];
    list.push(d);
    daysByWeek.set(d.week_id, list);
  }
  for (const w of weekRows) {
    const count = (daysByWeek.get(w.id) ?? []).length;
    if (pool.length > 0 && count > pool.length) {
      blockWarnings.push(
        `Week ${w.week_index}: ${count} workouts but client has ${pool.length} available days. Review schedule manually.`,
      );
    }
  }

  const rows: PreviewRow[] = [];
  const weekDurationDays = block.week_duration_days ?? 7;
  const startISO: string | null = block.start_date ?? null;
  const startDate = startISO ? parseISO(startISO) : null;

  for (const w of weekRows) {
    const weekStart = startDate ? addDays(startDate, w.week_index * weekDurationDays) : null;
    const weekDays = (daysByWeek.get(w.id) ?? []).sort((a, b) => a.day_index - b.day_index);

    // Determine which weekdays are taken by locked days (preserve them)
    const lockedAssignments = new Map<string, WeekDay>(); // dayId → weekday
    const consumedWeekdays = new Set<WeekDay>();
    if (weekStart) {
      for (const d of weekDays) {
        if (d.schedule_locked && d.scheduled_date) {
          const dt = parseISO(d.scheduled_date);
          const dow = dt.getDay();
          const weekday = (WEEK_DAYS.find((wd) => WEEKDAY_INDEX[wd] === dow) ?? null) as WeekDay | null;
          if (weekday) {
            lockedAssignments.set(d.id, weekday);
            consumedWeekdays.add(weekday);
          }
        }
      }
    }

    // Walk unlocked days, pull next available weekday from pool
    const remainingPool = pool.filter((d) => !consumedWeekdays.has(d));
    let poolCursor = 0;

    // Build per-day row first (without cardio)
    const tempRows: PreviewRow[] = [];
    for (const d of weekDays) {
      const warnings: string[] = [];
      let weekday: WeekDay | null = null;
      let dateISO: string | null = null;

      if (d.schedule_locked) {
        weekday = lockedAssignments.get(d.id) ?? null;
        dateISO = d.scheduled_date ?? null;
        if (weekday && !pool.includes(weekday)) {
          warnings.push(`Locked to ${weekday} but client is no longer available that day.`);
        }
      } else if (weekStart) {
        if (poolCursor < remainingPool.length) {
          weekday = remainingPool[poolCursor++];
          dateISO = format(dateForWeekday(weekStart, weekday), "yyyy-MM-dd");
        } else {
          warnings.push("No available weekday left for this workout.");
        }
      } else {
        warnings.push("Block has no start date.");
      }

      tempRows.push({
        dayId: d.id,
        weekId: w.id,
        weekIndex: w.week_index,
        dayIndex: d.day_index,
        title: d.title ?? `Day ${d.day_index}`,
        focus: d.focus ?? null,
        dateISO,
        weekday,
        dayType: classifyDayType(d.focus),
        cardio: [],
        manualOverride: !!d.schedule_locked,
        warnings,
      });
    }

    // Cardio placement per week
    if (weekStart && activeCardio.length > 0) {
      const workoutDates = new Set(tempRows.map((r) => r.dateISO).filter(Boolean) as string[]);
      const allWeekDates: string[] = Array.from({ length: 7 }, (_, i) =>
        format(addDays(weekStart, i), "yyyy-MM-dd"),
      );
      const nonWorkoutDates = allWeekDates.filter((d) => !workoutDates.has(d));
      const highDayRow = tempRows.find((r) => r.dayType === "High");

      for (const c of activeCardio) {
        const freq = Math.max(1, c.frequency_per_week ?? 1);
        const label = c.cardio_type === "Custom" ? c.custom_type ?? "Cardio" : c.cardio_type ?? "Cardio";
        const dayType = c.day_type ?? "General";
        const eligible: string[] = (() => {
          if (dayType === "Training Day") return [...workoutDates];
          if (dayType === "Rest Day") return nonWorkoutDates;
          if (dayType === "High Day") return highDayRow?.dateISO ? [highDayRow.dateISO] : [];
          // General / Custom — every day
          return allWeekDates;
        })();

        if (eligible.length === 0) {
          blockWarnings.push(`Cardio "${label}" (${dayType}) has no eligible day in week ${w.week_index}.`);
          continue;
        }

        const picks = eligible.slice(0, freq);
        for (const date of picks) {
          const row = tempRows.find((r) => r.dateISO === date);
          if (row) {
            row.cardio.push({ targetId: c.id, label, dayType });
          } else {
            // Rest-day cardio with no workout row — emit a synthetic warning marker
            // (preview is workout-row centric; client will see it from cardio targets visibility)
          }
        }
      }
    }

    rows.push(...tempRows);
  }

  const availabilityUsed = pool as string[];

  return { rows, blockWarnings, availabilityUsed, clientId: block.client_id, blockStartISO: startISO };
}

export async function applySchedule(blockId: string, preview: SchedulePreview): Promise<{ updated: number }> {
  let updated = 0;
  for (const r of preview.rows) {
    if (!r.dateISO) continue;
    if (r.manualOverride) {
      // Persist preview-edited manual overrides (and re-affirm existing ones)
      const { error } = await sb
        .from("pl_days")
        .update({ scheduled_date: r.dateISO, schedule_source: "manual", schedule_locked: true })
        .eq("id", r.dayId);
      if (!error) updated++;
    } else {
      const { error } = await sb
        .from("pl_days")
        .update({ scheduled_date: r.dateISO, schedule_source: "auto" })
        .eq("id", r.dayId)
        .eq("schedule_locked", false);
      if (!error) updated++;
    }
  }
  await sb
    .from("pl_blocks")
    .update({ last_scheduled_at: new Date().toISOString(), last_scheduled_availability: preview.availabilityUsed })
    .eq("id", blockId);
  return { updated };
}

export async function markDayManual(dayId: string, dateISO: string): Promise<void> {
  await sb
    .from("pl_days")
    .update({ scheduled_date: dateISO, schedule_source: "manual", schedule_locked: true })
    .eq("id", dayId);
}

export async function unlockDay(dayId: string): Promise<void> {
  await sb.from("pl_days").update({ schedule_locked: false, schedule_source: "auto" }).eq("id", dayId);
}

export async function clearAutoSchedule(
  blockId: string,
  opts: { keepManualOverrides: boolean },
): Promise<{ cleared: number }> {
  const { data: weeks } = await sb.from("pl_weeks").select("id").eq("block_id", blockId);
  const weekIds = (weeks ?? []).map((w: any) => w.id);
  if (weekIds.length === 0) return { cleared: 0 };

  const patch = opts.keepManualOverrides
    ? { scheduled_date: null, schedule_source: null }
    : { scheduled_date: null, schedule_source: null, schedule_locked: false };

  let q = sb.from("pl_days").update(patch).in("week_id", weekIds);
  if (opts.keepManualOverrides) q = q.eq("schedule_locked", false);

  const { data } = await q.select("id");
  await sb
    .from("pl_blocks")
    .update({ last_scheduled_at: null, last_scheduled_availability: null })
    .eq("id", blockId);
  return { cleared: (data ?? []).length };
}

export async function detectAvailabilityChange(blockId: string): Promise<{
  changed: boolean;
  before: string[];
  after: string[];
}> {
  const { data: block } = await sb
    .from("pl_blocks")
    .select("client_id, last_scheduled_availability, last_scheduled_at")
    .eq("id", blockId)
    .maybeSingle();
  if (!block) return { changed: false, before: [], after: [] };
  const before: string[] = block.last_scheduled_availability ?? [];
  if (!block.last_scheduled_at) return { changed: false, before, after: before };

  const { data: client } = await sb
    .from("clients")
    .select("committed_training_days, available_training_days, preferred_training_days, unavailable_training_days")
    .eq("id", block.client_id)
    .maybeSingle();
  const after = resolveAvailabilityPool(client ?? {});
  const a = [...before].sort().join("|");
  const b = [...after].sort().join("|");
  return { changed: a !== b, before, after };
}