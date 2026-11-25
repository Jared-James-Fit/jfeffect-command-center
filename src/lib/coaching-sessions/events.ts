/**
 * What a session can be about (pure, tested in coaching-sessions.test.ts): the
 * client's upcoming events, read from the records that already hold them, so
 * the coach never types a meet or a goal twice.
 *
 *  - competitions (Competition Intelligence) win: they hold the confirmed meet;
 *  - a meet prep (`pl_preps`) with a date, linked to a competition or not;
 *  - the approved competition plan's primary meet;
 *  - the coach's dated long-term goal, and a dated bodyweight goal.
 *
 * One event per date and meet. When two records say different things about
 * the same meet (a prep on Dec 5, its competition on Dec 6) it's one event
 * with the conflict named, never two events or a silent pick.
 */

export type EventKind = "competition" | "goal" | "general";

export type SessionEvent = {
  key: string;
  kind: EventKind;
  title: string;
  date: string | null;
  location: string | null;
  /** where it was read from, in words ("Competition Intelligence", "Meet prep") */
  source: string;
  competitionId: string | null;
  prepId: string | null;
  weightClass: string | null;
  daysOut: number | null;
  phase: string | null;
  conflicts: string[];
};

export type EventRecords = {
  today: string;
  competitions: Array<{
    id: string;
    name: string;
    meet_date: string;
    location?: string | null;
    weight_class?: string | null;
    status?: string | null;
    prep_id?: string | null;
    internal_test?: boolean | null;
  }>;
  preps: Array<{
    id: string;
    title?: string | null;
    event_name?: string | null;
    event_date?: string | null;
    weight_class?: string | null;
    status?: string | null;
    archived?: boolean | null;
  }>;
  plan?: { name: string | null; date: string | null } | null;
  longTermGoal?: { label: string | null; date: string | null } | null;
  bodyweightGoal?: { kg: number | null; date: string | null; direction?: string | null } | null;
  /** include internal test competitions (only a staff member's own record) */
  includeTests?: boolean;
};

const DAY = 86_400_000;
export const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / DAY);

/** Where a meet prep is, by days to the meet. */
export function meetPhase(daysOut: number | null): string | null {
  if (daysOut == null) return null;
  if (daysOut < 0) return "After the meet";
  if (daysOut === 0) return "Meet day";
  if (daysOut <= 7) return "Meet week";
  if (daysOut <= 14) return "Final preparation";
  if (daysOut <= 42) return "Peak";
  if (daysOut <= 84) return "Build";
  return "Foundation";
}

const norm = (s: string | null | undefined) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Two names for one meet: one contains the other, or they share most words. */
function sameMeet(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const wa = new Set(x.split(" ").filter((w) => w.length > 2));
  const wb = y.split(" ").filter((w) => w.length > 2);
  const shared = wb.filter((w) => wa.has(w)).length;
  return shared >= 2 && shared / Math.max(wa.size, wb.length) >= 0.5;
}

export function detectEvents(r: EventRecords): SessionEvent[] {
  const out: SessionEvent[] = [];
  const fmt = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
  const live = (d: string | null | undefined) => !!d && daysBetween(r.today, d) >= -7;

  for (const c of r.competitions) {
    if (c.internal_test && !r.includeTests) continue;
    if (c.status && !["upcoming", "completed"].includes(c.status)) continue;
    if (!live(c.meet_date)) continue;
    const d = daysBetween(r.today, c.meet_date);
    out.push({
      key: `competition:${c.id}`,
      kind: "competition",
      title: c.name,
      date: c.meet_date,
      location: c.location ?? null,
      source: "Competition Intelligence",
      competitionId: c.id,
      prepId: c.prep_id ?? null,
      weightClass: c.weight_class ?? null,
      daysOut: d,
      phase: meetPhase(d),
      conflicts: [],
    });
  }

  for (const p of r.preps) {
    if (p.archived || !p.event_date || !live(p.event_date)) continue;
    if (p.status && !["Active", "Planned"].includes(p.status)) continue;
    const name = p.event_name || p.title || "Meet";
    const linked = out.find(
      (e) =>
        e.kind === "competition" &&
        (e.prepId === p.id ||
          (e.date && Math.abs(daysBetween(e.date, p.event_date!)) <= 3 && sameMeet(e.title, name))),
    );
    if (linked) {
      linked.prepId = linked.prepId ?? p.id;
      if (linked.date !== p.event_date)
        linked.conflicts.push(`The meet prep says ${fmt(p.event_date)}; the competition says ${fmt(linked.date!)}`);
      if (p.weight_class && linked.weightClass && norm(p.weight_class).replace(/ kg$/, "") !== norm(linked.weightClass).replace(/ kg$/, ""))
        linked.conflicts.push(`The meet prep says ${p.weight_class}; the competition says ${linked.weightClass} kg`);
      continue;
    }
    const d = daysBetween(r.today, p.event_date);
    out.push({
      key: `prep:${p.id}`,
      kind: "competition",
      title: name,
      date: p.event_date,
      location: null,
      source: "Meet prep",
      competitionId: null,
      prepId: p.id,
      weightClass: p.weight_class ?? null,
      daysOut: d,
      phase: meetPhase(d),
      conflicts: [],
    });
  }

  if (r.plan?.date && live(r.plan.date)) {
    const had = out.find(
      (e) => e.kind === "competition" && e.date && Math.abs(daysBetween(e.date, r.plan!.date!)) <= 3,
    );
    if (had) {
      if (had.date !== r.plan.date)
        had.conflicts.push(`Their competition plan says ${fmt(r.plan.date)}`);
    } else {
      const d = daysBetween(r.today, r.plan.date);
      out.push({
        key: `plan:${r.plan.date}`,
        kind: "competition",
        title: r.plan.name || "Primary meet",
        date: r.plan.date,
        location: null,
        source: "Competition plan",
        competitionId: null,
        prepId: null,
        weightClass: null,
        daysOut: d,
        phase: meetPhase(d),
        conflicts: [],
      });
    }
  }

  const goal = r.longTermGoal;
  if (goal?.date && live(goal.date) && !out.some((e) => e.date === goal.date)) {
    const d = daysBetween(r.today, goal.date);
    out.push({
      key: `goal:${goal.date}`,
      kind: "goal",
      title: goal.label || "Long-term goal",
      date: goal.date,
      location: null,
      source: "Long-term goal",
      competitionId: null,
      prepId: null,
      weightClass: null,
      daysOut: d,
      phase: null,
      conflicts: [],
    });
  }
  const bw = r.bodyweightGoal;
  if (bw?.kg && bw.date && live(bw.date) && !out.some((e) => e.date === bw.date)) {
    const d = daysBetween(r.today, bw.date);
    out.push({
      key: `bodyweight:${bw.date}`,
      kind: "goal",
      title: `Bodyweight goal: ${bw.kg} kg`,
      date: bw.date,
      location: null,
      source: "Bodyweight goal",
      competitionId: null,
      prepId: null,
      weightClass: null,
      daysOut: d,
      phase: null,
      conflicts: [],
    });
  }

  return out.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
}

/** A meeting with no event: a progress review, a check-in, whatever the coach describes. */
export function generalEvent(title: string): SessionEvent {
  return {
    key: `general:${norm(title).slice(0, 40) || "meeting"}`,
    kind: "general",
    title: title.trim() || "General meeting",
    date: null,
    location: null,
    source: "Described by the coach",
    competitionId: null,
    prepId: null,
    weightClass: null,
    daysOut: null,
    phase: null,
    conflicts: [],
  };
}
