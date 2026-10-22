/**
 * lesson-reminders.server.ts
 *
 * While the coach reviews lessons before they go out (lesson_mode 'review'),
 * one push the day before: "📚 Tomorrow's lesson needs your OK", or how many
 * are waiting. Each lesson is nudged once (community_lesson_plan.reminded_at);
 * a lesson nobody approves simply doesn't post. Runs from the hourly hook.
 */
import { coachClock, coachTimeLabel, dayLabel } from "@/lib/lessons";

type Deps = {
  sendWebPushToUser: (
    admin: any,
    userId: string,
    payload: { title: string; body: string; url: string; tag: string; data: any },
    options: { category: any; eventKey: string },
  ) => Promise<{ sent: number; removed: number; skipped: string | null }>;
};

type Waiting = { id: string; day: string; post_at: string; title: string | null; reminded_at: string | null };

/** The push for the lessons waiting (null when there's nothing new to say). */
export function lessonReminder(rows: Waiting[], nowMs: number = Date.now()): { title: string; body: string } | null {
  const fresh = rows.filter((r) => !r.reminded_at);
  if (!fresh.length) return null;
  const first = fresh[0];
  if (rows.length === 1) {
    const today = coachClock(new Date(nowMs).toISOString()).date === first.day;
    return {
      title: `📚 ${today ? "Today's" : "Tomorrow's"} lesson needs your OK`,
      body: `${first.title ?? "Your next lesson"} · ${dayLabel(first.day)} at ${coachTimeLabel(first.post_at)}. Nothing goes out until you approve it.`,
    };
  }
  return {
    title: `📚 ${rows.length} lessons need your OK`,
    body: `Next: ${first.title ?? "a lesson"} · ${dayLabel(first.day)} at ${coachTimeLabel(first.post_at)}. Nothing goes out until you approve it.`,
  };
}

export async function runLessonReminders(admin: any, deps: Deps, nowMs: number = Date.now()) {
  const { data, error } = await admin.rpc("community_lessons_waiting", { _hours: 30 });
  if (error) return { error: error.message };
  const rows = (data ?? []) as Waiting[];
  const push = lessonReminder(rows, nowMs);
  if (!push) return { waiting: rows.length, sent: 0 };
  const { data: admins } = await admin.from("user_roles").select("user_id").eq("role", "admin");
  const ids = [...new Set(((admins ?? []) as { user_id: string | null }[]).map((a) => a.user_id).filter(Boolean))] as string[];
  const fresh = rows.filter((r) => !r.reminded_at);
  const key = fresh.map((r) => r.id).sort().join(",");
  let sent = 0;
  for (const uid of ids) {
    const r = await deps.sendWebPushToUser(
      admin,
      uid,
      { title: push.title, body: push.body, url: "/admin/community#tab=posts", tag: "lesson-review", data: { kind: "lesson_review", ids: fresh.map((r) => r.id) } },
      { category: "community", eventKey: `lesson_review:${key}:${uid}` },
    );
    sent += r.sent;
  }
  // nudged once, pushed or not (no push device is not a reason to try again every hour)
  await admin.from("community_lesson_plan").update({ reminded_at: new Date(nowMs).toISOString() }).in("id", fresh.map((r) => r.id));
  return { waiting: rows.length, sent };
}
