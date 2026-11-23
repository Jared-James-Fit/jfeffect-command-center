/**
 * "Your cardio plan has been updated" in the client's coach chat (Nov 23 2026):
 * the message that goes out when a coach publishes a new or changed cardio plan,
 * with a card of the week (each session: what, which days, how long, how hard)
 * and what changed, and one tap to the plan. Once per published version; never
 * for a draft, an autosave, a failed publish or a change only to the coach's
 * private notes. Pure; the server writes it (publish.server.ts), the thread
 * draws it (CardioPlanChatCard).
 */
import { daysWords, effortWords, isMeaningful, sessionTitle, settingsWords, TIMING_SHORT, type CardioPlan, type PlanContext, type SessionChange } from "@/lib/cardio/plan";
import type { SpeedUnit } from "@/lib/weight-management/units";

export const CARDIO_MESSAGE_KIND = "cardio_plan";
/** The page a client opens from the card (and the push). */
export const CLIENT_CARDIO_URL = "/portal/cardio";

export type CardioCardSession = { title: string; days: string; minutes: number; settings: string | null; effort: string | null; timing: string | null };

export type CardioMessageAttachment = {
  type: "link";
  kind: typeof CARDIO_MESSAGE_KIND;
  url: string;
  name: string;
  version_id: string;
  update: "new" | "changed";
  effective: string;
  scheduled: boolean;
  weekly_minutes: number;
  sessions: CardioCardSession[];
  changes: string[];
};

export function cardioMessageCard(x: {
  versionId: string;
  plan: CardioPlan;
  ctx: PlanContext;
  unit: SpeedUnit;
  changes: SessionChange[];
  update: "new" | "changed";
  effective: string;
  scheduled: boolean;
  weeklyMinutes: number;
}): CardioMessageAttachment {
  return {
    type: "link",
    kind: CARDIO_MESSAGE_KIND,
    url: CLIENT_CARDIO_URL,
    name: "Your cardio plan",
    version_id: x.versionId,
    update: x.update,
    effective: x.effective,
    scheduled: x.scheduled,
    weekly_minutes: x.weeklyMinutes,
    sessions: x.plan.sessions
      .filter((s) => s.enabled)
      .map((s) => ({
        title: sessionTitle(s),
        days: daysWords(s, x.ctx),
        minutes: s.minutes,
        settings: settingsWords(s, x.unit),
        effort: effortWords(s),
        timing: s.timing === "any" ? null : TIMING_SHORT[s.timing],
      })),
    // what changed, in the client's terms (a private note is never one)
    changes: x.update === "changed" ? x.changes.filter((c) => c.kind !== "note").flatMap((c) => c.lines).slice(0, 4) : [],
  };
}

const DATE = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
};

/** The words over the card. */
export function cardioMessageBody(firstName: string | null | undefined, x: { update: "new" | "changed"; scheduled: boolean; effective: string; empty: boolean }): string {
  const hey = (firstName ?? "").trim().split(/\s+/)[0];
  const lead = hey ? `Hey ${hey}! ` : "";
  if (x.empty) return `${lead}Your cardio plan has been updated: no cardio is set for now.${x.scheduled ? ` This starts ${DATE(x.effective)}.` : ""}`;
  const when = x.scheduled ? ` It starts ${DATE(x.effective)}.` : "";
  return x.update === "new"
    ? `${lead}Your cardio plan is ready. You can review your weekly schedule and targets below.${when}`
    : `${lead}Your cardio plan has been updated. You can review your new schedule and targets below.${when}`;
}

/** Whether a publish is worth telling the client about. */
export function shouldAnnounce(changes: SessionChange[], hasLogin: boolean): boolean {
  return hasLogin && isMeaningful(changes);
}
