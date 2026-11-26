/**
 * Server only: the weekly business summary push (Nov 26 2026). Mondays at WEEKLY_PUSH_HOUR in the
 * business's own clock (BI_TZ, the same day boundaries Analytics reads), every admin with a device
 * gets one push: last week's headline and the top recommendation (insights.ts weeklyPushPayload, no
 * dollar amounts on a lock screen), opening Cleo Insights. Run from the hourly push tick; sent once
 * per admin per week (the push dedupe key), and nothing at all when there's no summary to send.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWebPushToUser } from "@/lib/push/push.server";
import { loadInsights } from "./bi.server";
import { weeklyPushPayload } from "./insights";
import { businessDay, isWeeklySummaryTime, lastFullWeek, rangeFor } from "./period";

export const WEEKLY_PUSH_HOUR = 9;

export async function runWeeklyBusinessSummary(admin: SupabaseClient, now = new Date()): Promise<{ sent: number; skipped?: string }> {
  if (!isWeeklySummaryTime(now, WEEKLY_PUSH_HOUR)) return { sent: 0, skipped: "not due" };
  const db = admin as any;
  const { data: roles, error } = await db.from("user_roles").select("user_id").eq("role", "admin");
  if (error) throw new Error(error.message);
  const admins = [...new Set(((roles ?? []) as { user_id: string }[]).map((r) => r.user_id))];
  if (!admins.length) return { sent: 0, skipped: "no admins" };
  const { data: subs } = await db.from("push_subscriptions").select("user_id").eq("enabled", true).in("user_id", admins);
  const withDevice = [...new Set(((subs ?? []) as { user_id: string }[]).map((s) => s.user_id))];
  if (!withDevice.length) return { sent: 0, skipped: "no devices" };

  const today = businessDay(now);
  const view = await loadInsights(admin, rangeFor("30d", today), today);
  const payload = weeklyPushPayload(view.weekly, view.insights);
  if (!payload) return { sent: 0, skipped: "no summary" };
  const weekFrom = lastFullWeek(today).week.from;

  let sent = 0;
  for (const uid of withDevice) {
    const r = await sendWebPushToUser(
      admin,
      uid,
      { ...payload, tag: `bi-weekly:${weekFrom}`, data: { kind: "bi_weekly_summary", week: weekFrom } },
      { category: "reminders", eventKey: `bi-weekly:${uid}:${weekFrom}`, priority: "normal" },
    );
    if (r.sent > 0) sent++;
  }
  return { sent };
}
