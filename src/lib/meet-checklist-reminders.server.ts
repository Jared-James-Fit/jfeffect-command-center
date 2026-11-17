/**
 * Server-only: meet-day checklist reminders (pg_cron `meet-checklist-reminders`,
 * once a day at 9:11 Winnipeg). For each athlete with a meet checklist out and
 * a meet date (their answer, else the meet it was sent with):
 *   - two weeks out, if they haven't sent it: go through it;
 *   - two or three days out, while anything critical or important is open: pack and confirm;
 *   - the day before, while something critical is still open: last look.
 * A push each, at most once per meet (eventKey), never a text. Off when the
 * form's settings or that send said reminders off. Pure decision in
 * `reminderFor` (tested); the rest only reads and sends.
 */
import { readiness, type Readiness } from "@/lib/form-checklist";
import { conditionsPass, type AnswerLike } from "@/lib/form-logic";
import { daysUntil, meetFacts, meetIssues, MEET_CHECKLIST_FORM_TYPE } from "@/lib/meet-checklist";

type Db = any;

export type ReminderStage = "review" | "pack" | "final";

/** Which reminder is due today, if any (pure). */
export function reminderFor(opts: { days: number | null; sent: boolean; readiness: Readiness | null }): { stage: ReminderStage; title: string; body: string } | null {
  const { days, sent, readiness: r } = opts;
  if (days == null || days < 1) return null;
  if (days >= 4 && days <= 14) {
    if (sent) return null;
    return { stage: "review", title: "Your meet checklist", body: `Your meet is ${days} days out. Go through your checklist now so there's time to sort anything missing.` };
  }
  if (days === 2 || days === 3) {
    if (r && r.verdict === "ready") return null;
    const open = r ? r.critical + r.important : 0;
    return {
      stage: "pack",
      title: "Pack for your meet",
      body: open ? `${open} ${open === 1 ? "thing" : "things"} on your checklist still to sort. Pack and update it as you go.` : "Pack your bag and tick off your checklist as you go.",
    };
  }
  if (days === 1) {
    if (!r) return { stage: "final", title: "Meet tomorrow", body: "You haven't gone through your meet checklist yet. It takes two minutes." };
    // Critical items still needed or not confirmed yet.
    const critical = r.issues.filter((i) => i.severity === "critical").length;
    if (!critical) return null;
    return { stage: "final", title: "Meet tomorrow", body: `${critical} must-have ${critical === 1 ? "item isn't" : "items aren't"} sorted on your checklist. Take a last look tonight.` };
  }
  return null;
}

export async function runMeetChecklistReminders(admin: Db, now = new Date()) {
  const out = { considered: 0, sent: 0, skipped: 0, errors: 0 };
  const today = now.toLocaleDateString("en-CA", { timeZone: "America/Winnipeg" });
  const { data: forms } = await admin.from("nf_forms").select("id, settings").eq("form_type", MEET_CHECKLIST_FORM_TYPE).eq("archived", false).eq("active", true);
  const live = ((forms ?? []) as any[]).filter((f) => (f.settings as any)?.reminders !== false);
  if (!live.length) return out;
  const { sendWebPushToUser } = await import("@/lib/push/push.server");
  for (const form of live) {
    const [{ data: asg }, { data: qs }] = await Promise.all([
      admin.from("nf_assignments").select("client_id, settings, client:client_id(user_id, archived)").eq("form_id", form.id),
      admin.from("nf_questions").select("id, label, question_type, required, options, validation, conditional_logic, order_index").eq("form_id", form.id).is("archived_at", null),
    ]);
    const questions = ((qs ?? []) as any[]).sort((a, b) => a.order_index - b.order_index);
    for (const a of (asg ?? []) as any[]) {
      if ((a.settings as any)?.reminders === false || a.client?.archived || !a.client?.user_id) continue;
      out.considered++;
      try {
        const { data: sub } = await admin
          .from("nf_submissions")
          .select("id, status")
          .eq("form_id", form.id)
          .eq("client_id", a.client_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        let answers: Record<string, AnswerLike | undefined> = {};
        if (sub) {
          const { data: rows } = await admin.from("nf_answers").select("question_id, value_text, value_number, value_json").eq("submission_id", sub.id);
          answers = Object.fromEntries(((rows ?? []) as any[]).map((r) => [r.question_id, r]));
        }
        const facts = meetFacts(questions, answers);
        const meetDate = facts.meetDate ?? (a.settings as any)?.meet?.date ?? null;
        const r = sub
          ? readiness({ questions, answers, settings: form.settings, visible: (q) => conditionsPass(q.conditional_logic as any, answers), extra: meetIssues({ ...facts, meetDate }, today) })
          : null;
        const due = reminderFor({ days: daysUntil(meetDate, today), sent: !!sub && sub.status !== "in_progress", readiness: r });
        if (!due) {
          out.skipped++;
          continue;
        }
        const res = await sendWebPushToUser(
          admin,
          a.client.user_id,
          { title: due.title, body: due.body, url: "/portal/messages", tag: `meet-checklist:${a.client_id}` },
          { category: "reminders", eventKey: `meet_checklist:${a.client_id}:${meetDate}:${due.stage}` },
        );
        if (res.sent > 0) out.sent++;
        else out.skipped++;
      } catch (e: any) {
        out.errors++;
        console.error("[meet-checklist-reminders]", a.client_id, e?.message ?? e);
      }
    }
  }
  return out;
}
