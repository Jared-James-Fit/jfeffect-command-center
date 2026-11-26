/**
 * Goal intelligence's background work (pg_cron `goal-intel-tick`, every 5
 * minutes, only while goal_intel_due()): send client updates whose window is
 * up (when the client is offline), read goals out of new meeting analyses,
 * weekly check-ins and clients' own messages (everything lands proposed for
 * the coach), and read every open goal again when it's due (6 hours), which
 * also settles a passed goal's outcome. Deterministic: no model is called.
 */
import { assessDueClients, deliverOutbox, extractFromCheckin, extractFromMeeting, extractFromMessages, recoverStaleSending, settingJson } from "./goals.server";

type Db = any;

export type GoalTickReport = {
  recovered: number;
  sent: Record<string, number>;
  meetings: Array<{ id: string; created: number; updated: number; unchanged?: boolean } | { id: string; error: string }>;
  checkins: number;
  messages: number | null;
  assessed: Array<{ clientId: string; ok: boolean; error?: string }>;
};

export async function runGoalIntelTick(sb: Db, opts: { budgetMs?: number } = {}): Promise<GoalTickReport> {
  const started = Date.now();
  const left = () => (opts.budgetMs ?? 90_000) - (Date.now() - started);
  const report: GoalTickReport = { recovered: 0, sent: {}, meetings: [], checkins: 0, messages: null, assessed: [] };

  // 0. a send that was cut off part way: marked sent if it went, else waiting again
  report.recovered = await recoverStaleSending(sb).catch(() => 0);

  // 1. client updates whose window (or retry) is up
  const { data: due } = await sb
    .from("client_update_outbox")
    .select("id, send_after, next_attempt_at")
    .eq("status", "pending")
    .order("send_after", { ascending: true })
    .limit(40);
  const now = Date.now();
  for (const o of (due ?? []) as any[]) {
    if (left() < 20_000) break;
    if (Date.parse(o.next_attempt_at ?? o.send_after) > now) continue;
    const r = await deliverOutbox(sb, o.id).catch((e: any) => `error: ${e?.message ?? e}`);
    report.sent[r] = (report.sent[r] ?? 0) + 1;
  }

  // 2. meetings not read since they last changed (the database picks them, oldest first, never the same ones again)
  const { data: sessions, error: sErr } = await sb.rpc("goal_intel_meetings_to_scan", { _limit: 50 });
  if (sErr) report.meetings.push({ id: "-", error: sErr.message.slice(0, 200) });
  for (const s of (sessions ?? []) as any[]) {
    if (left() < 20_000) break;
    try {
      report.meetings.push({ id: s.id, ...(await extractFromMeeting(sb, s.id)) });
    } catch (e: any) {
      report.meetings.push({ id: s.id, error: String(e?.message ?? e).slice(0, 200) });
    }
  }

  // 3. weekly check-ins not read yet
  const { data: ids } = await sb.rpc("goal_intel_checkins_to_scan", { _limit: 60 });
  const checkinIds = ((ids ?? []) as any[]).map((r) => (typeof r === "string" ? r : r?.goal_intel_checkins_to_scan ?? r?.id)).filter(Boolean);
  if (checkinIds.length) {
    const { data: checkins } = await sb.from("messenger_checkins").select("id, client_id, answers, submitted_at").in("id", checkinIds).order("submitted_at", { ascending: true });
    for (const c of (checkins ?? []) as any[]) {
      if (left() < 15_000) break;
      report.checkins += await extractFromCheckin(sb, c).catch(() => 0);
    }
  }

  // 4. clients' own messages, at most every 30 minutes
  const { data: setting } = await sb.from("app_settings").select("value").eq("key", "goal_intel_scan").maybeSingle();
  const lastAt = Date.parse(settingJson(setting?.value).messages_at ?? "") || 0;
  if (left() > 15_000 && Date.now() - lastAt >= 30 * 60_000) report.messages = await extractFromMessages(sb).catch(() => null);

  // 5. open goals due a read (new, or 6 hours old)
  if (left() > 10_000) report.assessed = await assessDueClients(sb, { limit: 15, budgetMs: Math.max(5_000, left() - 5_000) });
  return report;
}
