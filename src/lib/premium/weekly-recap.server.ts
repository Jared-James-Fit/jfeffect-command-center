// Server-only: Cleo's weekly recap for Premium members (weekly-recap.ts has
// the rules). Run from the hourly push tick; on Monday at 9 AM in the member's
// zone it writes last week's recap to their Cleo inbox (one per week by the
// table's unique key) and pushes once.
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysISO, localDateISO, localHour, wallTimeToUtc } from "@/lib/schedule-time";
import { PREMIUM_KEY } from "./premium";
import { weekStart, weeklyRecap } from "./weekly-recap";

const DEFAULT_TZ = "America/Winnipeg";
export const RECAP_WEEKDAY_HOUR = 9;

export async function runWeeklyRecaps(admin: SupabaseClient, now = new Date()): Promise<{ written: number }> {
  const db = admin as any;
  const { data: grants } = await db
    .from("member_access")
    .select("member_id, expires_at, app_members!inner(user_id)")
    .eq("access_level_key", PREMIUM_KEY)
    .eq("active", true)
    .limit(1000);
  const userIds = [
    ...new Set(
      ((grants ?? []) as any[])
        .filter((g) => !g.expires_at || Date.parse(g.expires_at) > now.getTime())
        .map((g) => (Array.isArray(g.app_members) ? g.app_members[0]?.user_id : g.app_members?.user_id))
        .filter(Boolean),
    ),
  ] as string[];
  if (!userIds.length) return { written: 0 };
  const [{ data: prefs }, { data: clients }] = await Promise.all([
    db.from("push_notification_preferences").select("user_id, timezone").in("user_id", userIds),
    db.from("clients").select("id, user_id, timezone, archived").in("user_id", userIds),
  ]);
  const tzOf = new Map(((prefs ?? []) as any[]).map((p) => [p.user_id, p.timezone]));
  const clientOf = new Map(((clients ?? []) as any[]).filter((c) => !c.archived).map((c) => [c.user_id, c]));
  const { sendWebPushToUser } = await import("@/lib/push/push.server");
  let written = 0;
  for (const uid of userIds) {
    const client = clientOf.get(uid);
    if (!client) continue;
    const tz = tzOf.get(uid) || client.timezone || DEFAULT_TZ;
    const today = localDateISO(now, tz);
    const thisMonday = weekStart(today);
    if (today !== thisMonday || localHour(now, tz) < RECAP_WEEKDAY_HOUR) continue;
    const lastMonday = addDaysISO(thisMonday, -7);
    const before = addDaysISO(thisMonday, -14);
    const from = wallTimeToUtc(before, "00:00", tz).toISOString();
    const mid = wallTimeToUtc(lastMonday, "00:00", tz).toISOString();
    const to = wallTimeToUtc(thisMonday, "00:00", tz).toISOString();
    const { data: rows } = await db
      .from("pl_day_completions")
      .select("completed_at, actual_duration_min, logged_sets_count, session_weight_total, session_weight_unit")
      .eq("client_id", client.id)
      .not("completed_at", "is", null)
      .gte("completed_at", from)
      .lt("completed_at", to)
      .limit(200);
    const all = (rows ?? []) as any[];
    const recap = weeklyRecap(
      all.filter((r) => r.completed_at >= mid),
      all.filter((r) => r.completed_at < mid),
    );
    if (!recap) continue;
    const { data: saved, error } = await db
      .from("cleo_inbox_messages")
      .upsert({ user_id: uid, kind: "weekly_recap", period_key: lastMonday, title: recap.title, body: recap.body, cards: recap.cards }, { onConflict: "user_id,kind,period_key", ignoreDuplicates: true })
      .select("id");
    if (error || !(saved ?? []).length) continue; // already written this week
    written++;
    await sendWebPushToUser(
      admin,
      uid,
      { title: "Your week, from Cleo", body: recap.cards.map((c) => `${c.value} ${c.label}`).slice(0, 2).join(" · "), url: "/portal/messages?cleo=1", tag: `cleo-recap:${lastMonday}`, data: { kind: "cleo_recap" } },
      { category: "wins", eventKey: `cleo-recap:${uid}:${lastMonday}`, priority: "normal" },
    );
  }
  return { written };
}
