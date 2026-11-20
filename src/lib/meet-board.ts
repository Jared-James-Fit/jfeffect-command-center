/**
 * The meets the dashboard's Upcoming meets card lists, per athlete (pure,
 * tested in meet-board.test.ts): every dated meet on a live meet prep
 * (`pl_preps` Active / Planned) and on their approved competition plan
 * (`athlete_competition_plans`, what the coach signed off), from today out to
 * UPCOMING_MEET_DAYS, one entry per meet date, soonest first. A plan meet and
 * a meet prep on the same date are one meet: the prep's name, the plan's
 * "registered".
 *
 * Every coaching client counts, a coach's or admin's own athlete account
 * included (the coach competes too); only archived and self-serve members are
 * left out, like every coaching roster.
 */

/**
 * How far ahead a meet shows: 16 weeks, a full peak block (the program
 * generator's final-prep horizon and the check-in's "meet within 16 weeks").
 * 8 weeks hid a national championship 11 weeks out that was already being
 * peaked for.
 */
export const UPCOMING_MEET_DAYS = 112;

export type AthleteMeet = {
  name: string | null;
  date: string;
  days: number;
  /** From their competition plan: true / false when they said, null when nobody did. */
  registered: boolean | null;
};

export type PrepRow = {
  client_id: string;
  title?: string | null;
  event_name?: string | null;
  event_date: string | null;
  status?: string | null;
  archived?: boolean | null;
};

export type PlanMeet = { name?: string | null; level?: string | null; date?: string | null; registered?: boolean | null };
export type PlanRow = { client_id: string; status?: string | null; created_at?: string | null; plan?: { primary?: PlanMeet | null; meets?: PlanMeet[] | null } | null };
export type ClientRow = { id: string; full_name?: string | null; archived?: boolean | null; service_tier?: string | null };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function dayDiff(date: string, today: string): number {
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const b = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

const clean = (s: string | null | undefined) => (s ?? "").trim() || null;

/** Who's on the coaching roster (archived clients and self-serve members aren't). */
export function coachingAthletes(clients: ClientRow[]): Map<string, string> {
  return new Map(
    clients
      .filter((c) => !c.archived && c.service_tier !== "self_serve")
      .map((c) => [c.id, clean(c.full_name) ?? "Athlete"]),
  );
}

/** Each athlete's meets from today to the horizon, one per date, soonest first. */
export function athleteMeets(input: {
  preps: PrepRow[];
  plans: PlanRow[];
  today: string;
  horizonDays?: number;
}): Map<string, AthleteMeet[]> {
  const horizon = input.horizonDays ?? UPCOMING_MEET_DAYS;
  const out = new Map<string, Map<string, AthleteMeet>>();
  const inWindow = (date: string | null | undefined): date is string => {
    if (!date || !ISO.test(date)) return false;
    const d = dayDiff(date, input.today);
    return d >= 0 && d <= horizon;
  };
  const put = (clientId: string, m: AthleteMeet, from: "prep" | "plan") => {
    const byDate = out.get(clientId) ?? new Map<string, AthleteMeet>();
    const had = byDate.get(m.date);
    if (!had) byDate.set(m.date, m);
    // same date = the same meet: the prep's name wins, the plan says whether they're registered
    else byDate.set(m.date, {
      ...had,
      name: from === "prep" ? m.name ?? had.name : had.name ?? m.name,
      registered: had.registered ?? m.registered,
    });
    out.set(clientId, byDate);
  };

  for (const p of input.preps) {
    if (p.archived || (p.status && !["Active", "Planned"].includes(p.status))) continue;
    if (!inWindow(p.event_date)) continue;
    put(p.client_id, { name: clean(p.event_name) ?? clean(p.title), date: p.event_date, days: dayDiff(p.event_date, input.today), registered: null }, "prep");
  }

  // Only the newest approved plan per athlete is what the coach signed off on now.
  const latestPlan = new Map<string, PlanRow>();
  for (const p of input.plans) {
    if (p.status !== "approved") continue;
    const cur = latestPlan.get(p.client_id);
    if (!cur || String(p.created_at ?? "") > String(cur.created_at ?? "")) latestPlan.set(p.client_id, p);
  }
  for (const [clientId, p] of latestPlan) {
    const meets = [p.plan?.primary, ...((p.plan?.meets ?? []) as PlanMeet[])];
    for (const m of meets) {
      if (!m || !inWindow(m.date)) continue;
      put(clientId, {
        name: clean(m.name) ?? clean(m.level),
        date: m.date,
        days: dayDiff(m.date, input.today),
        registered: typeof m.registered === "boolean" ? m.registered : null,
      }, "plan");
    }
  }

  return new Map([...out].map(([id, byDate]) => [id, [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))]));
}

/** "TheOne · Mar 6" (+ "· not registered" when their plan says so). */
export function meetLine(m: Pick<AthleteMeet, "name" | "date" | "registered">): string {
  const day = new Date(`${m.date}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
  return [m.name ?? "Meet", day, m.registered === false ? "not registered" : null].filter(Boolean).join(" · ");
}
