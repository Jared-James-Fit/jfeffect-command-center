/**
 * The reads behind Cleo's schedule (cleo-schedule.ts): one client's or every client's dated workouts
 * in a range, from their unarchived primary program blocks, with the db Cleo reads as (the caller's
 * login, or the finance view). Lists of ids go 150 at a time, never one oversized request.
 */
import { filterPrimaryProgramBlocks } from "@/lib/at-home-backup";
import { datedWorkouts, type DatedDay, type DatedWorkout, type DayCompletion, type ScheduleEntry } from "@/lib/cleo-schedule";

const CHUNK = 150;
const DAY_COLS = "id, week_id, title, subtitle, focus, scheduled_date, is_optional";

function must<T = any>(res: { data: T[] | null; error: any }, what: string): T[] {
  if (res.error) throw new Error(`Could not read ${what}: ${res.error.message ?? res.error}`);
  return res.data ?? [];
}

async function inChunks<T = any>(ids: string[], what: string, read: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...must<T>(await read(ids.slice(i, i + CHUNK)), what));
  return out;
}

/** `clientIds` null = every client. */
export async function loadDatedWorkouts(db: any, opts: { clientIds: string[] | null; from: string; to: string }): Promise<DatedWorkout[]> {
  const { from, to } = opts;
  const only = opts.clientIds ? new Set(opts.clientIds) : null;
  const [datedDays, entriesRaw] = await Promise.all([
    // Every workout dated on itself in the range (whoever's); filtered to the right blocks below.
    db.from("pl_days").select(DAY_COLS).gte("scheduled_date", from).lte("scheduled_date", to).limit(5000).then((r: any) => must<any>(r, "workouts")),
    opts.clientIds
      ? inChunks<any>(opts.clientIds, "the schedule", (c) => db.from("pl_scheduled_workouts").select("id, client_id, source_day_id, scheduled_date, scheduled_time").in("client_id", c).gte("scheduled_date", from).lte("scheduled_date", to).limit(3000))
      : db.from("pl_scheduled_workouts").select("id, client_id, source_day_id, scheduled_date, scheduled_time").gte("scheduled_date", from).lte("scheduled_date", to).limit(5000).then((r: any) => must<any>(r, "the schedule")),
  ]);
  const datedIds = new Set<string>(datedDays.map((d: any) => d.id));
  const missing = [...new Set<string>(entriesRaw.map((e: any) => e.source_day_id).filter((id: string) => id && !datedIds.has(id)))];
  const dayRows = [...datedDays, ...(missing.length ? await inChunks<any>(missing, "workouts", (c) => db.from("pl_days").select(DAY_COLS).in("id", c)) : [])];
  if (!dayRows.length) return [];

  const weeks = await inChunks<any>([...new Set<string>(dayRows.map((d: any) => d.week_id).filter(Boolean))], "program weeks", (c) => db.from("pl_weeks").select("id, block_id").in("id", c));
  const blocks = filterPrimaryProgramBlocks(
    await inChunks<any>([...new Set<string>(weeks.map((w: any) => w.block_id).filter(Boolean))], "program blocks", (c) => db.from("pl_blocks").select("id, client_id, archived, client_visible, source_template_block_key").in("id", c)),
  ).filter((b: any) => b.client_id && !b.archived && (!only || only.has(b.client_id)));
  const blockById = new Map(blocks.map((b: any) => [b.id, b]));
  const blockOfWeek = new Map(weeks.map((w: any) => [w.id, blockById.get(w.block_id)]));
  const days: DatedDay[] = dayRows.flatMap((d: any) => {
    const b = blockOfWeek.get(d.week_id);
    if (!b) return [];
    return [{ id: d.id, clientId: b.client_id, title: d.subtitle || d.title || null, focus: d.focus ?? null, date: d.scheduled_date ?? null, optional: !!d.is_optional, visible: b.client_visible !== false }];
  });
  if (!days.length) return [];

  // A dated workout with a schedule entry on any date lives where its entries are.
  const scheduledDayIds = new Set<string>(entriesRaw.map((e: any) => e.source_day_id));
  const keptDated = days.filter((d) => datedIds.has(d.id)).map((d) => d.id);
  for (const r of await inChunks<any>(keptDated, "the schedule", (c) => db.from("pl_scheduled_workouts").select("source_day_id").in("source_day_id", c).limit(5000))) scheduledDayIds.add(r.source_day_id);
  const entries: ScheduleEntry[] = entriesRaw.map((e: any) => ({ id: e.id, clientId: e.client_id, dayId: e.source_day_id, date: e.scheduled_date, time: e.scheduled_time ? String(e.scheduled_time).slice(0, 5) : null }));
  const completions: DayCompletion[] = (
    await inChunks<any>(days.map((d) => d.id), "completions", (c) => db.from("pl_day_completions").select("day_id, scheduled_workout_id, completed_at, session_rating").in("day_id", c).limit(5000))
  ).map((c: any) => ({ dayId: c.day_id, entryId: c.scheduled_workout_id ?? null, completedAt: c.completed_at ?? null, rating: c.session_rating ?? null }));
  return datedWorkouts({ days, entries, scheduledDayIds, completions, from, to });
}
