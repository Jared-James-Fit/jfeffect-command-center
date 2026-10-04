// Server-only: the hourly push "tick" (run from the secret-guarded hourly
// hook). Three jobs, each built to stay quiet unless it matters:
//   1. release pushes that were held during quiet hours
//   2. one morning game plan per person (8am local, only if something's due)
//   3. monthly recap ready (the 1st, 9am local, only if they played)
import type { SupabaseClient } from "@supabase/supabase-js";
import { deliverQueuedPushes, localDate, localHour, sendWebPushToUser } from "@/lib/push/push.server";

const DEFAULT_TZ = "America/Winnipeg";
export const REMINDER_HOUR = 8;
export const RECAP_HOUR = 9;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "1 lift video" / "3 lift videos". */
export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Joins digest lines into one short, content-free body. */
export function digestBody(parts: Array<string | null | undefined | false>): string | null {
  const p = parts.filter(Boolean) as string[];
  return p.length ? p.join(" · ") : null;
}

export async function runPushTick(admin: SupabaseClient, now = new Date()) {
  const db = admin as any;
  const queue = await deliverQueuedPushes(admin);

  // Only people with at least one active device.
  const { data: subs } = await db.from("push_subscriptions").select("user_id").eq("enabled", true);
  const userIds = [...new Set(((subs ?? []) as any[]).map((s) => s.user_id).filter(Boolean))] as string[];
  if (!userIds.length) return { queue, digests: 0, recaps: 0 };

  const [{ data: prefs }, { data: roles }, { data: clients }] = await Promise.all([
    db.from("push_notification_preferences").select("user_id, timezone").in("user_id", userIds),
    db.from("user_roles").select("user_id, role").in("user_id", userIds),
    db.from("clients").select("id, user_id, timezone, archived").in("user_id", userIds),
  ]);
  const tzPref = new Map(((prefs ?? []) as any[]).map((p) => [p.user_id, p.timezone]));
  const staffRole = new Map<string, string>();
  ((roles ?? []) as any[]).forEach((r) => {
    if (r.role === "admin" || (r.role === "coach" && staffRole.get(r.user_id) !== "admin")) staffRole.set(r.user_id, r.role);
  });
  const clientByUser = new Map(((clients ?? []) as any[]).filter((c) => !c.archived).map((c) => [c.user_id, c]));

  let digests = 0;
  let recaps = 0;
  let leagueUsers: Set<string> | null = null;

  for (const uid of userIds) {
    const client = clientByUser.get(uid);
    const tz = tzPref.get(uid) || client?.timezone || DEFAULT_TZ;
    const hour = localHour(tz, now);
    const today = localDate(tz, now);

    // ---- Morning game plan ----
    if (hour === REMINDER_HOUR) {
      const role = staffRole.get(uid);
      const msg = role
        ? await staffDigest(db, uid, role, today)
        : client
          ? await clientDigest(db, client.id, today)
          : null;
      if (msg) {
        const r = await sendWebPushToUser(admin, uid, {
          title: msg.title,
          body: msg.body,
          url: msg.url,
          tag: "daily-digest",
          data: { kind: "daily_digest" },
        }, { category: "reminders", eventKey: `digest:${uid}:${today}`, priority: "normal" });
        if (r.sent > 0) digests++;
      }
    }

    // ---- Monthly recap ready ----
    if (client && hour === RECAP_HOUR && today.endsWith("-01")) {
      const prevMonth = `${addDays(today, -1).slice(0, 7)}-01`;
      if (!leagueUsers) leagueUsers = await leagueParticipants(db, prevMonth);
      if (leagueUsers.has(uid)) {
        const monthName = MONTHS[Number(prevMonth.slice(5, 7)) - 1];
        const r = await sendWebPushToUser(admin, uid, {
          title: `Your ${monthName} Recap is Ready 🎬`,
          body: "See your rank, points and records — then share it.",
          url: "/portal",
          tag: `recap:${prevMonth}`,
          data: { kind: "league_recap", month: prevMonth },
        }, { category: "wins", eventKey: `recap:${uid}:${prevMonth}`, priority: "normal" });
        if (r.sent > 0) recaps++;
      }
    }
  }
  return { queue, digests, recaps };
}

async function leagueParticipants(db: any, month: string): Promise<Set<string>> {
  const { data } = await db.rpc("league_month_scores", { _month: month, _now: new Date().toISOString() });
  return new Set(((data ?? []) as any[]).filter((r) => r.qualified || Number(r.total_points) > 0).map((r) => r.user_id));
}

async function clientDigest(db: any, clientId: string, today: string) {
  const [{ data: sched }, { data: pending }] = await Promise.all([
    db.from("pl_scheduled_workouts").select("id, source_day_id").eq("client_id", clientId).eq("scheduled_date", today),
    db.from("messenger_checkins").select("id")
      .eq("client_id", clientId).eq("status", "pending")
      .gte("created_at", new Date(Date.now() - 4 * 86_400_000).toISOString()).limit(1),
  ]);

  let workoutLine: string | null = null;
  const schedRows = (sched ?? []) as any[];
  if (schedRows.length) {
    const { data: done } = await db.from("pl_day_completions").select("scheduled_workout_id")
      .eq("client_id", clientId).in("scheduled_workout_id", schedRows.map((s) => s.id)).not("completed_at", "is", null);
    const doneIds = new Set(((done ?? []) as any[]).map((d) => d.scheduled_workout_id));
    const open = schedRows.filter((s) => !doneIds.has(s.id));
    if (open.length) {
      const { data: day } = await db.from("pl_days").select("title").eq("id", open[0].source_day_id).maybeSingle();
      const title = String(day?.title ?? "").trim().slice(0, 40);
      workoutLine = title ? `Today: ${title}` : "You've got a workout today";
    }
  }
  const checkinLine = (pending ?? []).length ? "your check-in is waiting" : null;
  const body = digestBody([workoutLine, checkinLine]);
  if (!body) return null;
  return {
    title: "Today's Game Plan 💪",
    body: body.charAt(0).toUpperCase() + body.slice(1),
    url: workoutLine ? "/portal/workouts" : "/portal/messages",
  };
}

async function staffDigest(db: any, uid: string, role: string, today: string) {
  let scope: string[] | null = null; // null = every client (admin)
  if (role !== "admin") {
    const { data: coach } = await db.from("coaches").select("id").eq("user_id", uid).maybeSingle();
    if (!coach) return null;
    const { data: mine } = await db.from("clients").select("id").eq("assigned_coach_id", coach.id).eq("archived", false);
    scope = ((mine ?? []) as any[]).map((c) => c.id);
    if (!scope.length) return null;
  }
  const inScope = (q: any) => (scope ? q.in("client_id", scope) : q);

  const [{ data: due }, { data: plans }, { count: videos }] = await Promise.all([
    inScope(db.from("nutrition_targets").select("client_id")
      .eq("status", "Active").not("end_date", "is", null).lte("end_date", addDays(today, 3))),
    inScope(db.from("nutrition_ai_plans").select("client_id").eq("status", "ready").is("applied_at", null)),
    inScope(db.from("lift_videos").select("id", { count: "exact", head: true }).eq("status", "New Upload")),
  ]);
  const nDue = new Set(((due ?? []) as any[]).map((r) => r.client_id)).size;
  const nPlans = new Set(((plans ?? []) as any[]).map((r) => r.client_id)).size;
  const body = digestBody([
    nDue > 0 && `${plural(nDue, "nutrition update")} due`,
    nPlans > 0 && `${plural(nPlans, "AI plan")} to apply`,
    (videos ?? 0) > 0 && `${plural(videos ?? 0, "lift video")} to review`,
  ]);
  if (!body) return null;
  return { title: "Coach Game Plan ☕", body, url: nDue > 0 || nPlans > 0 ? "/admin/nutrition-targets" : "/admin/lift-videos" };
}
