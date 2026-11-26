/**
 * Every competition across the coach's athletes, sorted by what needs the
 * coach (pure, tested): assessments waiting (urgent first, then the ones
 * needing approval, then unread), game plans the athlete hasn't acknowledged
 * close to the meet, athletes needing an intervention (a serious concern),
 * recommended strategy calls, meets in the next two days (the command centre),
 * and everyone else by phase. A competition with nothing to do never asks.
 */
import { daysBetween, phaseFor, PHASE_LABEL, MILESTONE_BY_KIND } from "./milestones";

export type OverviewCompetition = {
  id: string;
  client_id: string;
  athlete: string;
  name: string;
  meet_date: string;
  meet_end_date?: string | null;
  status: string;
  live?: any;
  watch?: any[];
};
export type OverviewAssessment = {
  id: string;
  competition_id: string;
  client_id: string;
  kind: string;
  version: number;
  status: string;
  urgency: "routine" | "attention" | "urgent";
  needs_approval: boolean;
  headline: string;
  coach_message: string | null;
  created_at: string;
  coach_opened_at: string | null;
  released_at: string | null;
  athlete_acknowledged_at: string | null;
  superseded_at: string | null;
};

export type OverviewItem = {
  kind: "review" | "approve" | "unacknowledged" | "intervene" | "call" | "meet_day";
  competitionId: string;
  clientId: string;
  assessmentId: string | null;
  athlete: string;
  meet: string;
  daysOut: number;
  title: string;
  detail: string | null;
  urgent: boolean;
  unread: boolean;
};

const RANK: Record<OverviewItem["kind"], number> = {
  intervene: 0,
  approve: 1,
  review: 2,
  unacknowledged: 3,
  call: 4,
  meet_day: 5,
};

export function competitionOverview(input: {
  today: string;
  competitions: OverviewCompetition[];
  assessments: OverviewAssessment[];
}) {
  const items: OverviewItem[] = [];
  const upcoming = input.competitions.filter(
    (c) => c.status === "upcoming" && daysBetween(input.today, c.meet_date) >= -1,
  );
  for (const c of upcoming) {
    const days = daysBetween(input.today, c.meet_date);
    const mine = input.assessments.filter((a) => a.competition_id === c.id && !a.superseded_at);
    const base = {
      competitionId: c.id,
      clientId: c.client_id,
      athlete: c.athlete,
      meet: c.name,
      daysOut: days,
    };
    for (const a of mine) {
      const title =
        MILESTONE_BY_KIND[a.kind as keyof typeof MILESTONE_BY_KIND]?.title ?? "Assessment";
      if (["ready", "reviewed", "changes_requested"].includes(a.status) && a.needs_approval) {
        items.push({
          ...base,
          kind: "approve",
          assessmentId: a.id,
          title: `${title} needs your approval`,
          detail: a.coach_message ?? a.headline,
          urgent: a.urgency === "urgent",
          unread: !a.coach_opened_at,
        });
      } else if (a.status === "ready") {
        items.push({
          ...base,
          kind: "review",
          assessmentId: a.id,
          title: `${title} is ready`,
          detail: a.coach_message ?? a.headline,
          urgent: a.urgency === "urgent",
          unread: !a.coach_opened_at,
        });
      } else if (
        a.status === "released" &&
        (a.kind === "game_plan" || a.kind === "confirm") &&
        !a.athlete_acknowledged_at &&
        days <= 10
      ) {
        items.push({
          ...base,
          kind: "unacknowledged",
          assessmentId: a.id,
          title: "Game plan not acknowledged yet",
          detail: null,
          urgent: days <= 3,
          unread: false,
        });
      }
    }
    const serious = (c.watch ?? []).filter((w: any) => w?.severity === "serious");
    if (serious.length && !mine.some((a) => a.urgency === "urgent" && a.status !== "released")) {
      items.push({
        ...base,
        kind: "intervene",
        assessmentId: null,
        title: serious[0].text,
        detail: serious.length > 1 ? `and ${serious.length - 1} more` : null,
        urgent: true,
        unread: false,
      });
    }
    if (c.live?.call && days > 0)
      items.push({
        ...base,
        kind: "call",
        assessmentId: null,
        title: `Strategy call worth it (${c.live.call.minutes} min)`,
        detail: c.live.call.reasons?.[0] ?? null,
        urgent: false,
        unread: false,
      });
    if (days >= -1 && days <= 2)
      items.push({
        ...base,
        kind: "meet_day",
        assessmentId: null,
        title:
          days <= 0
            ? "Meet day: open the command centre"
            : `Meet in ${days} day${days === 1 ? "" : "s"}`,
        detail: null,
        urgent: false,
        unread: false,
      });
  }
  items.sort(
    (a, b) =>
      Number(b.urgent) - Number(a.urgent) ||
      RANK[a.kind] - RANK[b.kind] ||
      Number(b.unread) - Number(a.unread) ||
      a.daysOut - b.daysOut,
  );
  const byPhase = upcoming
    .map((c) => ({
      ...c,
      daysOut: daysBetween(input.today, c.meet_date),
      phase: phaseFor(daysBetween(input.today, c.meet_date)),
    }))
    .sort((a, b) => a.daysOut - b.daysOut)
    .map((c) => ({ ...c, phaseLabel: PHASE_LABEL[c.phase] }));
  const needsYou = items.filter((i) => i.kind !== "meet_day" && i.kind !== "call");
  return {
    items,
    byPhase,
    needsYou: needsYou.length,
    unread: items.filter((i) => i.unread).length,
  };
}
