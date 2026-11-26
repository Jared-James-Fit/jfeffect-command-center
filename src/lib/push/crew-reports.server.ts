// Server-only: tell the team about Crew items waiting for review that nobody
// was pushed about yet: what the word filter flagged (it has no reporter's
// phone to fire notifyCommunityReport) and any report whose instant push
// didn't go. Run from the hourly push tick. One content-free push per staff
// login per run, deduped against the instant one (`crew_report` rate key, 30
// minutes) and held through quiet hours like every normal push. Who reported
// is never in it.
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWebPushToUser } from "@/lib/push/push.server";

/** "1 thing" / "3 things" in Crew to review. */
export function crewReviewTitle(n: number): string {
  return `🚩 Crew: ${n} ${n === 1 ? "thing" : "things"} to review`;
}

export async function notifyWaitingCrewReports(admin: SupabaseClient, now = new Date()) {
  const db = admin as any;
  const since = new Date(now.getTime() - 2 * 86_400_000).toISOString();
  const { data: rows } = await db
    .from("community_reports")
    .select("id, target_kind, target_id")
    .eq("status", "open")
    .is("notified_at", null)
    .gte("created_at", since)
    .limit(500);
  const list = (rows ?? []) as { id: string; target_kind: string; target_id: string }[];
  if (!list.length) return { items: 0, sent: 0 };
  await db.from("community_reports").update({ notified_at: now.toISOString() }).in("id", list.map((r) => r.id));
  const items = new Set(list.map((r) => `${r.target_kind}:${r.target_id}`)).size;
  const { data: staff } = await db.from("user_roles").select("user_id").in("role", ["admin", "coach"]);
  const recipients = [...new Set(((staff ?? []) as any[]).map((s) => s.user_id as string).filter(Boolean))];
  const hour = now.toISOString().slice(0, 13);
  let sent = 0;
  for (const uid of recipients) {
    const r = await sendWebPushToUser(
      admin,
      uid,
      {
        title: crewReviewTitle(items),
        body: "Reported or flagged. It's waiting in Crew under Needs you.",
        url: "/admin/community",
        tag: "crew_report",
        data: { kind: "crew_report" },
      },
      { category: "community", eventKey: `crew_reports_waiting:${hour}:${uid}`, rateKey: "crew_report", rateWindowMinutes: 30, priority: "normal" },
    );
    sent += r.sent;
  }
  return { items, sent };
}
