/**
 * The meet day's estimated timeline (pure, tested in competition-handling.test.ts):
 * wake-up to awards, worked out from what's known about the day (the lifting
 * start, the weigh-in, the flight, how many flights and lifters, platforms,
 * travel, the warm-ups and the attempts). Every entry says what it is:
 *
 *  - confirmed    an official time someone confirmed (the meet's schedule, the
 *                 coach's own confirmation of an entry);
 *  - estimated    worked out from the schedule with the platform's pacing;
 *  - recommended  what we suggest doing then (wake up, leave, eat, warm up);
 *  - unconfirmed  rests on an assumption nobody has confirmed (no start time,
 *                 the federation's weigh-in rule not confirmed for the meet,
 *                 a default number of lifters).
 *
 * Nothing here invents an official schedule: with no start time, times stay
 * relative ("about 2 hours before lifting"). A confirmed entry is never moved by
 * a new estimate; when they disagree by 10 minutes or more the entry carries
 * the new estimate as a conflict for the coach to accept or keep. On the day,
 * actual platform progression (an anchor and the time it happened) moves every
 * later estimate by the same amount.
 *
 * Times are minutes after midnight of the entry's date, in the meet's own time
 * zone (a 24-hour weigh-in sits on the day before).
 */
import type { Lift } from "./types";

export type TimingStatus = "confirmed" | "estimated" | "recommended" | "unconfirmed";
export const TIMING_WORD: Record<TimingStatus, string> = {
  confirmed: "Confirmed",
  estimated: "Estimated",
  recommended: "Recommended",
  unconfirmed: "Unconfirmed",
};

export type Known<T> = { value: T | null; confirmed: boolean };
const unknown = <T>(): Known<T> => ({ value: null, confirmed: false });

/** Something on the day that actually happened, and when (meet-day progression). */
export type Anchor =
  | "session"
  | `${Lift}_start`
  | `${Lift}_flight`
  | `${Lift}_${1 | 2 | 3}`
  | "weigh_in"
  | "finish";

export type TimelineInput = {
  meetDate: string;
  /** powerlifting has lifts and flights; anything else is a start time and its logistics */
  sport?: string | null;
  /** the federation's weigh-in rule (2 or 24 hours), and whether it's confirmed for this meet */
  weighInHours: number | null;
  rulesConfirmed?: boolean;
  liftingStart: Known<string>;
  weighIn: Known<string>;
  /** their flight's position in the session (A = 1) */
  flight: Known<number>;
  flights: Known<number>;
  lifters: Known<number>;
  platforms?: number | null;
  /** seconds a platform takes per attempt, loading included */
  attemptSeconds?: number | null;
  /** minutes between disciplines once the last flight finishes */
  breakMinutes?: number | null;
  travelMinutes: Known<number>;
  warmups?: Partial<Record<Lift, Array<{ kg: number; reps: number; minutesBefore: number }>>>;
  attempts?: Partial<Record<Lift, Array<number | null>>>;
  awards?: boolean;
  /** entries the coach confirmed at a time ("HH:MM") */
  confirmed?: Record<string, { at: string }>;
  /** what actually happened on the day */
  progress?: Array<{ anchor: Anchor; at: string }>;
};

export type TimelineGroup = "before" | Lift | "event" | "after";
export type TimelineKind =
  | "logistics"
  | "weigh_in"
  | "nutrition"
  | "warmup"
  | "warmup_set"
  | "attempt"
  | "flight"
  | "break"
  | "finish"
  | "awards"
  | "event";

export type TimelineEntry = {
  key: string;
  label: string;
  group: TimelineGroup;
  kind: TimelineKind;
  date: string;
  /** minutes after midnight of `date`; null when it can't be worked out yet */
  at: number | null;
  from: number | null;
  to: number | null;
  status: TimingStatus;
  /** when it can't be a clock time: "About 2 hours before lifting" */
  relative?: string;
  lift?: Lift;
  attempt?: 1 | 2 | 3;
  kg?: number | null;
  reps?: number;
  note?: string;
  /** a confirmed time the new estimate disagrees with by 10+ minutes */
  conflict?: { estimated: number };
  /** moved by what happened on the day */
  live?: boolean;
};

export type Timeline = {
  entries: TimelineEntry[];
  /** what the estimate assumed (for the "how it's worked out" fold) */
  assumptions: string[];
  /** what would make it better, most useful first */
  missing: string[];
  sessionEnd: number | null;
  /** the day the timeline is for (and the day before, for a 24-hour weigh-in) */
  meetDate: string;
  /** minutes the day is running behind (+) or ahead (−) of the estimate, from the latest progress */
  shift: number | null;
};

export const DEFAULT_LIFTERS = 12;
export const DEFAULT_ATTEMPT_SECONDS = 70;
export const DEFAULT_BREAK_MINUTES = 15;
export const DEFAULT_TRAVEL_MINUTES = 30;
const FLIGHT_CHANGE_MINUTES = 3;
const CONFLICT_MINUTES = 10;

export const LIFT_ORDER: Lift[] = ["squat", "bench", "deadlift"];
const LIFT_WORD: Record<Lift, string> = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" };
const ORDINAL = ["Opener", "Second", "Third"] as const;

/** "HH:MM" → minutes, or null. */
export function toMinutes(hhmm: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Minutes → "HH:MM" (wrapping past midnight). */
export function hhmm(minutes: number): string {
  const t = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** Minutes → "9:05 AM". */
export function clock(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "";
  const t = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(t / 60);
  const m = t % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** An entry's time in words: "9:05 AM", "9:05 – 9:40 AM", or its relative words. */
export function entryTime(e: Pick<TimelineEntry, "at" | "from" | "to" | "relative">): string {
  if (e.from != null && e.to != null && e.to - e.from >= 5) {
    const a = clock(e.from);
    const b = clock(e.to);
    const sameHalf = a.slice(-2) === b.slice(-2);
    return sameHalf ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`;
  }
  if (e.at != null) return clock(e.at);
  return e.relative ?? "Time not known yet";
}

function dayBefore(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const worst = (...s: TimingStatus[]): TimingStatus =>
  s.includes("unconfirmed") ? "unconfirmed" : s.includes("estimated") ? "estimated" : "confirmed";

/**
 * The timeline. Deterministic: the same inputs give the same entries in the
 * same order.
 */
export function buildTimeline(input: TimelineInput): Timeline {
  const assumptions: string[] = [];
  const missing: string[] = [];
  const entries: TimelineEntry[] = [];
  const date = input.meetDate;
  const powerlifting = !input.sport || input.sport === "powerlifting";
  const S = toMinutes(input.liftingStart.value);
  const startStatus: TimingStatus = S == null ? "unconfirmed" : input.liftingStart.confirmed ? "confirmed" : "estimated";
  if (S == null) missing.push("The session's start time (from the meet's schedule)");
  else if (!input.liftingStart.confirmed) missing.push("Confirm the session's start time against the meet's schedule");

  const wiHours = input.weighInHours ?? (powerlifting ? 2 : null);
  const ruleStatus: TimingStatus = input.rulesConfirmed ? "confirmed" : "unconfirmed";
  const sameDay = wiHours != null && wiHours <= 3;
  const W0 = toMinutes(input.weighIn.value);

  // ── pacing ────────────────────────────────────────────────────────────
  const n = input.lifters.value ?? DEFAULT_LIFTERS;
  const A = (input.attemptSeconds ?? DEFAULT_ATTEMPT_SECONDS) / 60;
  const brk = input.breakMinutes ?? DEFAULT_BREAK_MINUTES;
  const platforms = Math.max(1, input.platforms ?? 1);
  const idx = input.flight.value ?? 1;
  const F = input.flights.value ?? Math.max(idx, input.flight.value ? idx : 1);
  const flightsSeq = Math.ceil(F / platforms);
  const pos = Math.ceil(idx / platforms);
  const flightDur = 3 * n * A + FLIGHT_CHANGE_MINUTES;
  const paceStatus: TimingStatus =
    input.lifters.confirmed && input.flights.confirmed && input.flight.confirmed ? "estimated" : "unconfirmed";
  if (powerlifting) {
    if (input.lifters.value == null) assumptions.push(`About ${DEFAULT_LIFTERS} lifters in a flight`);
    if (input.flights.value == null)
      assumptions.push(F === 1 ? "One flight in the session" : `${F} flights in the session`);
    if (input.flight.value == null) {
      assumptions.push("Their flight lifts first in the session");
      missing.push("Their flight (A, B…)");
    }
    assumptions.push(`About ${Math.round(A * 60)} seconds an attempt with loading`);
    assumptions.push(`About ${brk} minutes between lifts once the last flight finishes`);
    if (input.lifters.value == null || input.flights.value == null)
      missing.push("How many flights and lifters are in their session (the start list)");
  }

  const travel = input.travelMinutes.value ?? DEFAULT_TRAVEL_MINUTES;
  if (input.travelMinutes.value == null) {
    assumptions.push(`${DEFAULT_TRAVEL_MINUTES} minutes to get to the venue`);
    missing.push("How long it takes to get to the venue");
  }

  // ── lifts ─────────────────────────────────────────────────────────────
  type Slot = { at: number; from: number; to: number };
  const liftSlots: Partial<Record<Lift, Slot[]>> = {};
  let sessionEnd: number | null = null;
  if (powerlifting && S != null) {
    LIFT_ORDER.forEach((lift, d) => {
      const discStart = S + d * (flightsSeq * flightDur + brk);
      const myFlight = discStart + (pos - 1) * flightDur;
      const slots: Slot[] = [];
      for (let r = 0; r < 3; r++) {
        const roundStart = myFlight + r * n * A;
        const from = roundStart;
        const to = roundStart + (n - 1) * A;
        slots.push({ at: Math.round((from + to) / 2), from: Math.round(from), to: Math.round(to) });
      }
      liftSlots[lift] = slots;
      const flightStatus: TimingStatus =
        d === 0 && pos === 1 ? startStatus : worst(startStatus, paceStatus === "unconfirmed" ? "unconfirmed" : "estimated");
      entries.push({
        key: `${lift}_flight`,
        label: `${LIFT_WORD[lift]}: their flight starts`,
        group: lift,
        kind: "flight",
        date,
        at: Math.round(myFlight),
        from: null,
        to: null,
        status: flightStatus,
        lift,
      });
      const wu = input.warmups?.[lift] ?? [];
      if (wu.length) {
        const first = wu[0];
        const opener = slots[0];
        entries.push({
          key: `${lift}_warmup`,
          label: `${LIFT_WORD[lift]} warm-ups start`,
          group: lift,
          kind: "warmup",
          date,
          at: Math.round(opener.at - first.minutesBefore),
          from: Math.round(opener.from - first.minutesBefore),
          to: Math.round(opener.to - first.minutesBefore),
          status: "recommended",
          lift,
          note: "Count attempts, not minutes: last warm-up when about 8 attempts are left before theirs",
        });
        wu.forEach((s, i) => {
          entries.push({
            key: `${lift}_wu_${i + 1}`,
            label: `${LIFT_WORD[lift]} warm-up ${i + 1}`,
            group: lift,
            kind: "warmup_set",
            date,
            at: Math.round(opener.at - s.minutesBefore),
            from: Math.round(opener.from - s.minutesBefore),
            to: Math.round(opener.to - s.minutesBefore),
            status: "recommended",
            lift,
            kg: s.kg,
            reps: s.reps,
          });
        });
      }
      slots.forEach((s, r) => {
        entries.push({
          key: `${lift}_${r + 1}`,
          label: `${LIFT_WORD[lift]} ${ORDINAL[r].toLowerCase()}`,
          group: lift,
          kind: "attempt",
          date,
          at: s.at,
          from: s.from,
          to: s.to,
          status: worst(startStatus, "estimated", paceStatus === "unconfirmed" ? "unconfirmed" : "estimated"),
          lift,
          attempt: (r + 1) as 1 | 2 | 3,
          kg: input.attempts?.[lift]?.[r] ?? null,
        });
      });
      if (lift !== "deadlift") {
        entries.push({
          key: `${lift}_break`,
          label: lift === "squat" ? "Between squat and bench" : "Between bench and deadlift",
          group: lift,
          kind: "break",
          date,
          at: slots[2].to + 5,
          from: null,
          to: null,
          status: "recommended",
          note: "A small snack and fluids within 10 minutes; stay warm, don't sit the whole break",
        });
      }
    });
    sessionEnd = Math.round(S + 3 * flightsSeq * flightDur + 2 * brk);
  }

  // ── before ────────────────────────────────────────────────────────────
  const firstWarmup = entries.find((e) => e.kind === "warmup" && e.lift === "squat");
  let W: number | null = null;
  let wStatus: TimingStatus = "unconfirmed";
  let wDate = date;
  if (sameDay) {
    if (W0 != null) {
      W = W0;
      wStatus = input.weighIn.confirmed ? "confirmed" : "estimated";
    } else if (S != null) {
      W = S - Math.round(wiHours! * 60);
      wStatus = worst(startStatus === "confirmed" ? "estimated" : startStatus, ruleStatus === "confirmed" ? "estimated" : "unconfirmed");
      if (!input.rulesConfirmed) missing.push("Confirm the weigh-in time (the meet's own rules)");
    }
    entries.unshift({
      key: "weigh_in",
      label: "Weigh-in",
      group: "before",
      kind: "weigh_in",
      date,
      at: W,
      from: W,
      to: W != null && W0 == null ? W + 90 : null,
      status: wStatus,
      relative: W == null ? `About ${wiHours} hours before lifting` : undefined,
      note: "Openers and rack heights handed in at weigh-in",
    });
  } else if (wiHours != null && wiHours >= 12) {
    wDate = dayBefore(date);
    W = W0;
    wStatus = W0 != null ? (input.weighIn.confirmed ? "confirmed" : "estimated") : "unconfirmed";
    if (W0 == null) missing.push("The weigh-in time the day before");
    entries.unshift({
      key: "weigh_in",
      label: "Weigh-in (the day before)",
      group: "before",
      kind: "weigh_in",
      date: wDate,
      at: W,
      from: null,
      to: null,
      status: wStatus,
      relative: W == null ? "The day before, on the meet's schedule" : undefined,
      note: "Then eat and drink normally: familiar food, nothing new",
    });
  }

  // eat after weigh-in
  if (W != null || entries.some((e) => e.key === "weigh_in")) {
    entries.push({
      key: "post_weigh_in_meal",
      label: "Eat and drink after weighing in",
      group: "before",
      kind: "nutrition",
      date: wDate,
      at: W != null ? W + 10 : null,
      from: null,
      to: null,
      status: "recommended",
      relative: W == null ? "Straight after weigh-in" : undefined,
      note: "Carbohydrate and fluids, food you know sits well",
    });
  }

  const arriveAt: number | null = sameDay
    ? W != null
      ? W - 20
      : null
    : S != null
      ? S - 75
      : null;
  const arriveStatus: TimingStatus = arriveAt == null ? "unconfirmed" : "recommended";
  const departAt = arriveAt != null ? arriveAt - travel : null;
  const wakeAt = departAt != null ? departAt - (sameDay ? 75 : 90) : null;
  entries.push(
    {
      key: "wake",
      label: "Wake up",
      group: "before",
      kind: "logistics",
      date,
      at: wakeAt,
      from: null,
      to: null,
      status: arriveStatus,
      relative: wakeAt == null ? "About 3 hours before lifting" : undefined,
    },
    {
      key: "depart",
      label: "Leave for the venue",
      group: "before",
      kind: "logistics",
      date,
      at: departAt,
      from: null,
      to: null,
      status: departAt == null ? "unconfirmed" : input.travelMinutes.value == null ? "unconfirmed" : "recommended",
      relative: departAt == null ? "Allow for travel and parking" : undefined,
      note: input.travelMinutes.value != null ? `About ${travel} minutes to get there` : undefined,
    },
    {
      key: "arrive",
      label: "Arrive",
      group: "before",
      kind: "logistics",
      date,
      at: arriveAt,
      from: null,
      to: null,
      status: arriveStatus,
      relative: arriveAt == null ? (sameDay ? "20 minutes before weigh-in" : "75 minutes before lifting") : undefined,
      note: "Find the warm-up room, the platform and where attempts are handed in",
    },
  );
  if (powerlifting && firstWarmup?.at != null) {
    entries.push({
      key: "general_warmup",
      label: "General warm-up",
      group: "before",
      kind: "warmup",
      date,
      at: firstWarmup.at - 20,
      from: null,
      to: null,
      status: "recommended",
      note: "Easy movement and the mobility they do before heavy squats",
    });
  }

  if (!powerlifting) {
    entries.push({
      key: "event_start",
      label: "Event starts",
      group: "event",
      kind: "event",
      date,
      at: S,
      from: null,
      to: null,
      status: startStatus,
      relative: S == null ? "On the event's schedule" : undefined,
    });
    if (S != null)
      entries.push({
        key: "event_warmup",
        label: "Warm up",
        group: "event",
        kind: "warmup",
        date,
        at: S - 45,
        from: null,
        to: null,
        status: "recommended",
      });
  }

  // ── after ─────────────────────────────────────────────────────────────
  if (powerlifting) {
    entries.push({
      key: "finish",
      label: "Session ends",
      group: "after",
      kind: "finish",
      date,
      at: sessionEnd,
      from: null,
      to: null,
      status: sessionEnd == null ? "unconfirmed" : worst(startStatus, paceStatus === "unconfirmed" ? "unconfirmed" : "estimated"),
      relative: sessionEnd == null ? "After the last flight's deadlifts" : undefined,
    });
  }
  if (input.awards !== false) {
    const awardsAt = sessionEnd != null ? sessionEnd + 20 : null;
    entries.push({
      key: "awards",
      label: "Awards",
      group: "after",
      kind: "awards",
      date,
      at: awardsAt,
      from: awardsAt,
      to: awardsAt != null ? awardsAt + 25 : null,
      status: "unconfirmed",
      relative: awardsAt == null ? "After the session, on the meet's schedule" : undefined,
    });
  }

  // ── confirmed entries and the day's progression ───────────────────────
  applyConfirmed(entries, input.confirmed ?? {});
  const shift = applyProgress(entries, input.progress ?? []);

  entries.sort(compareEntries);
  return { entries, assumptions, missing: [...new Set(missing)], sessionEnd, meetDate: date, shift };
}

function compareEntries(a: TimelineEntry, b: TimelineEntry): number {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  const ta = a.at ?? a.from ?? Number.POSITIVE_INFINITY;
  const tb = b.at ?? b.from ?? Number.POSITIVE_INFINITY;
  if (ta !== tb) return ta - tb;
  return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
}
const KIND_ORDER: TimelineKind[] = [
  "logistics",
  "weigh_in",
  "nutrition",
  "warmup",
  "flight",
  "warmup_set",
  "attempt",
  "break",
  "event",
  "finish",
  "awards",
];

/** A coach's confirmed time wins; a new estimate 10+ minutes away is kept beside it as a conflict. */
function applyConfirmed(entries: TimelineEntry[], confirmed: Record<string, { at: string }>) {
  for (const e of entries) {
    const c = confirmed[e.key];
    const at = c ? toMinutes(c.at) : null;
    if (at == null) continue;
    if (e.at != null && Math.abs(e.at - at) >= CONFLICT_MINUTES && e.status !== "recommended")
      e.conflict = { estimated: e.at };
    const shift = e.from != null && e.at != null ? at - e.at : 0;
    e.at = at;
    if (e.from != null && e.to != null) {
      e.from += shift;
      e.to += shift;
    }
    e.status = "confirmed";
    e.relative = undefined;
  }
}

/**
 * What happened on the day moves everything planned after it: the latest
 * anchor's difference from the plan shifts later estimates (never a confirmed
 * entry, which keeps its time and shows the new estimate as a conflict).
 */
function applyProgress(entries: TimelineEntry[], progress: Array<{ anchor: Anchor; at: string }>): number | null {
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const anchorKey = (a: Anchor): string =>
    a === "session" ? "squat_flight" : a.endsWith("_start") ? a.replace("_start", "_flight") : a;
  let best: { planned: number; delta: number } | null = null;
  for (const p of progress) {
    const e = byKey.get(anchorKey(p.anchor));
    const actual = toMinutes(p.at);
    if (!e || e.at == null || actual == null) continue;
    if (!best || e.at >= best.planned) best = { planned: e.at, delta: actual - e.at };
    e.live = true;
    e.at = actual;
    e.from = e.from != null ? actual : null;
    e.to = e.to != null ? actual : null;
    e.status = "confirmed";
  }
  if (!best) return null;
  if (best.delta === 0) return 0;
  for (const e of entries) {
    if (e.live || e.at == null || e.at <= best.planned) continue;
    if (e.status === "confirmed") {
      e.conflict = { estimated: e.at + best.delta };
      continue;
    }
    e.at += best.delta;
    if (e.from != null) e.from += best.delta;
    if (e.to != null) e.to += best.delta;
    e.live = true;
    if (e.status === "unconfirmed") e.status = "estimated";
  }
  return best.delta;
}

/** Read the stored schedule settings (`competitions.schedule`) safely. */
export type StoredSchedule = {
  confirmed?: Record<string, { at: string; by?: string; on?: string }>;
  progress?: Array<{ anchor: Anchor; at: string; by?: string; ts?: string }>;
  /** which of the event's own fields are confirmed from the meet's schedule */
  verified?: Partial<Record<"lifting_start" | "weigh_in_at" | "flight" | "flights" | "lifters", boolean>>;
  attemptSeconds?: number | null;
  breakMinutes?: number | null;
  travelMinutes?: number | null;
  awards?: boolean;
};

const ANCHOR_RE = /^(session|weigh_in|finish|(squat|bench|deadlift)_(start|flight|[123]))$/;

export function readSchedule(raw: unknown): StoredSchedule {
  const r = raw && typeof raw === "object" ? (raw as Record<string, any>) : {};
  const confirmed: StoredSchedule["confirmed"] = {};
  if (r.confirmed && typeof r.confirmed === "object") {
    for (const [k, v] of Object.entries(r.confirmed as Record<string, any>)) {
      if (/^[a-z0-9_]{2,40}$/.test(k) && v && toMinutes(v.at) != null) confirmed[k] = { at: hhmm(toMinutes(v.at)!), by: v.by, on: v.on };
    }
  }
  const progress = Array.isArray(r.progress)
    ? (r.progress as any[])
        .filter((p) => p && ANCHOR_RE.test(String(p.anchor)) && toMinutes(p.at) != null)
        .map((p) => ({ anchor: p.anchor as Anchor, at: hhmm(toMinutes(p.at)!), by: p.by, ts: p.ts }))
        .slice(-40)
    : [];
  const num = (v: unknown, lo: number, hi: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
  const verified: StoredSchedule["verified"] = {};
  if (r.verified && typeof r.verified === "object")
    for (const k of ["lifting_start", "weigh_in_at", "flight", "flights", "lifters"] as const)
      if (typeof r.verified[k] === "boolean") verified[k] = r.verified[k];
  return {
    confirmed,
    progress,
    verified,
    attemptSeconds: num(r.attemptSeconds, 30, 240),
    breakMinutes: num(r.breakMinutes, 0, 90),
    travelMinutes: num(r.travelMinutes, 0, 600),
    awards: r.awards === false ? false : true,
  };
}

/** "A" → 1, "B" → 2, "2" → 2; anything else null. */
export function flightIndex(flight: string | null | undefined): number | null {
  const f = String(flight ?? "").trim().toUpperCase();
  if (!f) return null;
  const letter = /^(?:FLIGHT\s*)?([A-T])$/.exec(f);
  if (letter) return letter[1].charCodeAt(0) - 64;
  const num = /^(?:FLIGHT\s*)?(\d{1,2})$/.exec(f);
  if (num) return Math.max(1, Math.min(20, Number(num[1])));
  return null;
}

/** The timeline's input from a competition row, its gameplan's warm-ups and attempts, and the athlete's travel time. */
export function timelineInputFrom(c: {
  meet_date: string;
  sport?: string | null;
  lifting_start?: string | null;
  weigh_in_at?: string | null;
  flight?: string | null;
  flights_in_session?: number | null;
  lifters_per_flight?: number | null;
  platforms?: number | null;
  schedule?: unknown;
  rules?: { weighInHours?: number | null; confirmed?: boolean } | null;
}, plan?: {
  warmups?: TimelineInput["warmups"];
  attempts?: TimelineInput["attempts"];
  travelMinutes?: number | null;
} | null): TimelineInput {
  const s = readSchedule(c.schedule);
  const v = s.verified ?? {};
  const fi = flightIndex(c.flight);
  const travel = plan?.travelMinutes ?? s.travelMinutes ?? null;
  return {
    meetDate: String(c.meet_date).slice(0, 10),
    sport: c.sport ?? "powerlifting",
    weighInHours: c.rules?.weighInHours ?? null,
    rulesConfirmed: !!c.rules?.confirmed,
    liftingStart: { value: c.lifting_start ?? null, confirmed: !!v.lifting_start && !!c.lifting_start },
    weighIn: { value: c.weigh_in_at ?? null, confirmed: !!v.weigh_in_at && !!c.weigh_in_at },
    flight: { value: fi, confirmed: !!v.flight && fi != null },
    flights: { value: c.flights_in_session ?? null, confirmed: !!v.flights && c.flights_in_session != null },
    lifters: { value: c.lifters_per_flight ?? null, confirmed: !!v.lifters && c.lifters_per_flight != null },
    platforms: c.platforms ?? null,
    attemptSeconds: s.attemptSeconds,
    breakMinutes: s.breakMinutes,
    travelMinutes: travel != null ? { value: travel, confirmed: true } : unknown(),
    warmups: plan?.warmups,
    attempts: plan?.attempts,
    awards: s.awards,
    confirmed: Object.fromEntries(Object.entries(s.confirmed ?? {}).map(([k, x]) => [k, { at: x.at }])),
    progress: (s.progress ?? []).map((p) => ({ anchor: p.anchor, at: p.at })),
  };
}

/** The wall-clock minutes now in a time zone, and that day ("YYYY-MM-DD"). */
export function nowInZone(tz: string | null | undefined, at: Date = new Date()): { date: string; minutes: number } {
  const zone = tz || "America/Winnipeg";
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
  } catch {
    return nowInZone("America/Winnipeg", at);
  }
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, minutes: Number(g("hour")) * 60 + Number(g("minute")) };
}

/** The zone's short name for a label: "CST", "EST", else the zone itself. */
export function zoneLabel(tz: string | null | undefined, at: Date = new Date()): string {
  const zone = tz || "America/Winnipeg";
  try {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: zone, timeZoneName: "short" })
      .formatToParts(at)
      .find((x) => x.type === "timeZoneName")?.value;
    return p || zone;
  } catch {
    return zone;
  }
}
