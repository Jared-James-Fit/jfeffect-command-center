/**
 * App Review demo accounts (App Store guideline 2.1: Apple's reviewer needs a working login with
 * something to look at). The pure parts, tested in app-review-demo.test.ts; the server function
 * that writes is app-review-demo.functions.ts.
 *
 * Two existing logins, found by email (Jared creates them himself; nothing here creates a user or
 * sets a password): a coaching client and a free member. Everything seeded is synthetic and every
 * row it creates is listed in `app_review_demo_records`, so "Remove demo data" deletes exactly
 * those rows and nothing else.
 */

export const DEMO_SETTINGS_KEY = "app_review_demo_accounts";
export const DEFAULT_DEMO_CLIENT_EMAIL = "appreview.client@jfeffect.com";
export const DEFAULT_DEMO_MEMBER_EMAIL = "appreview.member@jfeffect.com";

export type DemoAccountKey = "client" | "member";
export type DemoConfig = { clientEmail: string; memberEmail: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** app_settings.value (JSON text) → the two emails, lowercased; anything unusable falls back to the defaults. */
export function parseDemoConfig(raw: unknown): DemoConfig {
  let o: any = raw;
  if (typeof raw === "string") {
    try {
      o = JSON.parse(raw);
    } catch {
      o = null;
    }
  }
  const pick = (v: unknown, fallback: string) => {
    const e = typeof v === "string" ? v.trim().toLowerCase() : "";
    return EMAIL.test(e) ? e : fallback;
  };
  const clientEmail = pick(o?.client_email, DEFAULT_DEMO_CLIENT_EMAIL);
  let memberEmail = pick(o?.member_email, DEFAULT_DEMO_MEMBER_EMAIL);
  // the same address for both would seed one login twice
  if (memberEmail === clientEmail) memberEmail = DEFAULT_DEMO_MEMBER_EMAIL === clientEmail ? DEFAULT_DEMO_CLIENT_EMAIL : DEFAULT_DEMO_MEMBER_EMAIL;
  return { clientEmail, memberEmail };
}

/** `ilike` treats % and _ as wildcards: a plain email must match itself only. */
export function escapeIlike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** The tier each demo login must already be on. Nothing here changes a login's tier. */
export const DEMO_TIER: Record<DemoAccountKey, string> = { client: "coaching", member: "self_serve" };

export type DemoTarget = {
  id: string;
  user_id: string | null;
  service_tier: string | null;
  archived?: boolean | null;
  email?: string | null;
};

/**
 * Why an account can't be seeded, or null. Real people are protected three ways: the email must be
 * the configured one (found by it), the login must exist already and be on the right tier, and it
 * must have no training, check-ins or cardio of its own (a real client always has some) unless
 * the demo seeded them.
 */
export function demoRefusal(
  key: DemoAccountKey,
  email: string,
  target: DemoTarget | null,
  own: { programs: number; checkIns: number; cardio: number },
  seeded: number,
): string | null {
  if (!target) return `No ${key === "client" ? "client" : "member"} account for ${email} yet. Create the login first (Admin → Clients, or approve the member), then run this again.`;
  if (!target.user_id) return `${email} has no login yet. Send the invite and set up the login, then run this again.`;
  if (target.archived) return `${email} is archived. Restore it or use another address.`;
  if (target.service_tier !== DEMO_TIER[key]) {
    return `${email} is on the ${target.service_tier ?? "unknown"} plan; the demo ${key === "client" ? "coaching client" : "free member"} must be on ${DEMO_TIER[key]}. Nothing was changed.`;
  }
  if (seeded === 0 && (own.programs > 0 || own.checkIns > 0 || own.cardio > 0)) {
    return `${email} already has its own training data, so it is not a blank demo login. Nothing was changed: use a fresh login.`;
  }
  return null;
}

/** Tables the demo writes, children first: the order "Remove demo data" deletes in (logged training must go before the program: the history guard). */
export const DEMO_DELETE_ORDER = [
  "pl_row_results",
  "pl_day_completions",
  "messenger_checkins",
  "cardio_targets",
  "pl_blocks",
  "pl_preps",
] as const;
export type DemoTable = (typeof DEMO_DELETE_ORDER)[number];

export function groupByTable(rows: ReadonlyArray<{ table_name: string; record_id: string }>): Record<DemoTable, string[]> {
  const out = Object.fromEntries(DEMO_DELETE_ORDER.map((t) => [t, [] as string[]])) as Record<DemoTable, string[]>;
  for (const r of rows) (out as Record<string, string[]>)[r.table_name]?.push(r.record_id);
  return out;
}

export function chunk<T>(xs: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/* ───────────────────────── synthetic content ───────────────────────── */

const DAY = 86_400_000;

/** `now` minus whole days, at 17:30 UTC (a workout after work), as an ISO string. */
export function daysAgoAt(now: Date, days: number): string {
  const d = new Date(now.getTime() - days * DAY);
  d.setUTCHours(17, 30, 0, 0);
  return d.toISOString();
}

export function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

/** The reps a text asks for ("5", "8-10", "6 each side"): the first number, or null (AMRAP, time, nothing). */
export function repsFromText(text: string | null | undefined): number | null {
  const m = /\d+/.exec(text ?? "");
  const n = m ? Number(m[0]) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 50 ? n : null;
}

const KG_PER_LB = 0.45359237;

/** A made-up working weight in the person's unit: what the program says if it says, else a plain ramp, rounded to a loadable number. */
export function demoLoad(row: { load_lb?: number | null; load_kg?: number | null }, unit: "lb" | "kg", setIndex: number): number {
  const fromProgram = row.load_lb != null ? Number(row.load_lb) : row.load_kg != null ? Number(row.load_kg) / KG_PER_LB : null;
  const lb = fromProgram && fromProgram > 0 ? fromProgram : 85 + 10 * Math.min(setIndex, 4);
  const v = unit === "kg" ? lb * KG_PER_LB : lb;
  const step = unit === "kg" ? 2.5 : 5;
  return Math.max(step, Math.round(v / step) * step);
}

export type DemoRow = { id: string; sets: number | null; reps_text: string | null; load_lb?: number | null; load_kg?: number | null; measurement_type?: string | null; duration_seconds?: number | null };

/** The logged sets (pl_row_results rows) for one finished workout. Only plain weight-and-reps rows; at most 6 sets each. */
export function demoSets(rows: readonly DemoRow[], o: { clientId: string; unit: "lb" | "kg"; completedAt: string }) {
  const out: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    const reps = repsFromText(r.reps_text);
    const timed = (r.measurement_type && r.measurement_type !== "reps") || r.duration_seconds != null;
    if (!reps || timed) continue;
    const sets = Math.max(1, Math.min(Number(r.sets) || 3, 6));
    for (let i = 1; i <= sets; i++) {
      const load = demoLoad(r, o.unit, i);
      const kg = o.unit === "kg" ? load : load * KG_PER_LB;
      const lb = o.unit === "lb" ? load : load / KG_PER_LB;
      out.push({
        client_id: o.clientId,
        row_id: r.id,
        set_index: i,
        actual_load: load,
        actual_load_unit: o.unit,
        entered_value: load,
        entered_unit: o.unit,
        actual_load_kg: Math.round(kg * 100) / 100,
        actual_load_lb: Math.round(lb * 100) / 100,
        normalized_kg: Math.round(kg * 100) / 100,
        normalized_lb: Math.round(lb * 100) / 100,
        actual_reps: reps,
        actual_rpe: i === sets ? "8" : "7",
        completed_at: o.completedAt,
        notes: null,
      });
    }
  }
  return out;
}

export const DEMO_WORKOUT_NOTE = "Demo data for App Review";

export function demoCompletion(o: { dayId: string; clientId: string; completedAt: string }) {
  return {
    day_id: o.dayId,
    client_id: o.clientId,
    completed_at: o.completedAt,
    actual_duration_min: 52,
    client_notes: DEMO_WORKOUT_NOTE,
  };
}

/** A completed weekly check-in with made-up answers (the shape the check-in card reads). */
export function demoCheckIn(o: { clientId: string; submittedAt: string }) {
  return {
    client_id: o.clientId,
    task_type: "weekly_checkin",
    status: "completed",
    answers: {
      training_rating: 4,
      nutrition_rating: 4,
      win: "Hit every session this week.",
      recovery_flags: ["All good"],
      next_week_goal: "Add a little weight to the squat.",
      help: "",
    },
    context_snapshot: { demo: true },
    // the plain stand-in recap (no AI is called for demo data)
    ai_analysis: {
      fallback: true,
      summary: "Demo check-in (made-up answers for App Review).",
      wins: ["Hit every session this week."],
      focus: [],
      goals: ["Add a little weight to the squat."],
      red_flags: [],
      coach_notes: [],
      suggested_response: "",
      urgency: "normal",
    },
    ai_status: "ready",
    submitted_at: o.submittedAt,
  };
}

/** A small cardio plan: three easy sessions a week. */
export function demoCardio(o: { clientId: string; startDate: string }) {
  return {
    client_id: o.clientId,
    cardio_type: "Incline Walking",
    frequency_per_week: 3,
    duration_minutes: 30,
    intensity: "Easy, you can hold a conversation",
    step_target: 8000,
    start_date: o.startDate,
    status: "Active",
    visible_to_client: true,
    client_notes: "Demo cardio plan for App Review.",
    admin_notes: "App Review demo data. Remove it with Remove demo data in Admin → Settings.",
  };
}

/** The first days of the program that count as already trained (the oldest first). */
export const DEMO_LOGGED_WORKOUTS = 3;

export function summarize(r: { counts: Record<string, number> }): string {
  const c = r.counts;
  const parts = [
    c.pl_blocks ? `${c.pl_blocks} program${c.pl_blocks === 1 ? "" : "s"}` : null,
    c.pl_day_completions ? `${c.pl_day_completions} logged workout${c.pl_day_completions === 1 ? "" : "s"}` : null,
    c.pl_row_results ? `${c.pl_row_results} sets` : null,
    c.messenger_checkins ? `${c.messenger_checkins} check-in${c.messenger_checkins === 1 ? "" : "s"}` : null,
    c.cardio_targets ? `${c.cardio_targets} cardio plan${c.cardio_targets === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "nothing yet";
}
