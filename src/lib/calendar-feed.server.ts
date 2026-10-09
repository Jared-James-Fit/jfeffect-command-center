// Server-only: everything that goes in a client's private calendar feed.
//   - 1:1 sessions (timed, with a 1-hour phone alert; cancelled ones stay as
//     CANCELLED so subscribed calendars remove them)
//   - scheduled workouts (all-day "free" events, no alert)
//   - coach events they're part of
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FeedEvent } from "@/lib/ics-feed";
import { filterPrimaryProgramBlocks } from "@/lib/at-home-backup";
import { isInactivePrimaryDay } from "@/lib/active-calendar";
import { wallTimeToUtc } from "@/lib/schedule-time";

type Admin = SupabaseClient<any, any, any>;

const PAST_DAYS = 30;

export async function buildClientFeedEvents(admin: Admin, clientId: string, origin: string): Promise<FeedEvent[]> {
  const now = Date.now();
  const sinceISO = new Date(now - PAST_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const sinceDate = sinceISO.slice(0, 10);
  const today = new Date(now).toISOString().slice(0, 10);

  const [sessions, workouts, events] = await Promise.all([
    feedSessions(admin, clientId, sinceISO, origin),
    feedWorkouts(admin, clientId, sinceDate, origin),
    feedEvents(admin, clientId, today, origin),
  ]);
  return [...sessions, ...workouts, ...events];
}

async function feedSessions(admin: Admin, clientId: string, sinceISO: string, origin: string): Promise<FeedEvent[]> {
  const { data } = await admin
    .from("pt_sessions")
    .select("id, title, session_type, starts_at, ends_at, location, notes, client_visible_notes, status, updated_at")
    .eq("client_id", clientId)
    .eq("visible_to_client", true)
    .gte("starts_at", sinceISO)
    .order("starts_at", { ascending: true })
    .limit(500);
  return ((data ?? []) as any[])
    .filter((s) => s.status !== "Rescheduled")
    .map((s) => ({
      uid: `pt-${s.id}@jfeffect.com`,
      start: new Date(s.starts_at),
      end: new Date(s.ends_at),
      summary: s.title || s.session_type || "Training session",
      location: s.location,
      description: s.client_visible_notes && s.notes ? s.notes : null,
      url: `${origin}/portal/calendar`,
      cancelled: s.status === "Cancelled",
      lastModified: s.updated_at ? new Date(s.updated_at) : null,
    }));
}

/**
 * Dated workouts from the client's visible program, using the same block and
 * day rules as the in-app workout list (no archived blocks or days, no
 * At-Home Backup blocks).
 */
async function feedWorkouts(admin: Admin, clientId: string, sinceDate: string, origin: string): Promise<FeedEvent[]> {
  const { data: blocks } = await admin
    .from("pl_blocks")
    .select("id, source_template_block_key, status")
    .eq("client_id", clientId)
    .eq("client_visible", true)
    .neq("status", "Archived");
  const blockIds = filterPrimaryProgramBlocks((blocks ?? []) as any[]).map((b: any) => b.id);
  if (!blockIds.length) return [];
  const { data: weeks } = await admin.from("pl_weeks").select("id").in("block_id", blockIds);
  const weekIds = ((weeks ?? []) as any[]).map((w) => w.id);
  if (!weekIds.length) return [];
  const { data: days } = await admin
    .from("pl_days")
    .select("id, title, focus, day_index, archived, deleted_at")
    .in("week_id", weekIds);
  const dayById = new Map(((days ?? []) as any[]).filter((d) => !isInactivePrimaryDay(d)).map((d) => [d.id, d]));
  if (!dayById.size) return [];
  const { data: instances } = await admin
    .from("pl_scheduled_workouts")
    .select("id, source_day_id, scheduled_date, updated_at")
    .eq("client_id", clientId)
    .in("source_day_id", Array.from(dayById.keys()))
    .gte("scheduled_date", sinceDate)
    .order("scheduled_date", { ascending: true })
    .limit(400);
  return ((instances ?? []) as any[]).map((w) => {
    const day = dayById.get(w.source_day_id);
    const name = (day?.title || "").trim() || (day?.day_index ? `Day ${day.day_index}` : "Training");
    return {
      uid: `workout-${w.id}@jfeffect.com`,
      start: new Date(`${w.scheduled_date}T00:00:00Z`),
      end: new Date(`${w.scheduled_date}T00:00:00Z`),
      allDayDate: w.scheduled_date,
      summary: `Workout: ${name}`,
      description: day?.focus ? `Focus: ${day.focus}` : null,
      url: `${origin}/portal/workouts/${w.source_day_id}?instance=${w.id}`,
      lastModified: w.updated_at ? new Date(w.updated_at) : null,
    };
  });
}

async function feedEvents(admin: Admin, clientId: string, today: string, origin: string): Promise<FeedEvent[]> {
  const [{ data: assigned }, { data: events }] = await Promise.all([
    admin.from("event_assignments").select("event_id").eq("client_id", clientId),
    admin
      .from("events")
      .select("id, name, event_date, start_time, end_time, timezone, location, client_facing_notes, status, audience_scope, updated_at")
      .in("status", ["Active", "Completed"])
      .gte("event_date", today)
      .limit(200),
  ]);
  const assignedIds = new Set(((assigned ?? []) as any[]).map((r) => r.event_id));
  return ((events ?? []) as any[])
    .filter((e) => assignedIds.has(e.id) || e.audience_scope === "all_coaching")
    .map((e) => {
      const base = {
        uid: `event-${e.id}@jfeffect.com`,
        summary: e.name,
        location: e.location,
        description: e.client_facing_notes,
        url: `${origin}/portal/events/${e.id}`,
        lastModified: e.updated_at ? new Date(e.updated_at) : null,
      };
      if (!e.start_time) {
        const d = new Date(`${e.event_date}T00:00:00Z`);
        return { ...base, start: d, end: d, allDayDate: e.event_date };
      }
      const tz = e.timezone || "America/Winnipeg";
      const start = wallTimeToUtc(e.event_date, String(e.start_time).slice(0, 5), tz);
      const endRaw = e.end_time ? wallTimeToUtc(e.event_date, String(e.end_time).slice(0, 5), tz) : null;
      const end = endRaw && endRaw > start ? endRaw : new Date(start.getTime() + 60 * 60 * 1000);
      return { ...base, start, end };
    });
}
