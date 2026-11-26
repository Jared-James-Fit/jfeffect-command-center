/**
 * Account headshots and Crew profile-picture reminders: the rules, pure and
 * tested (headshots.test.ts). Two different photos, never mixed:
 *
 *   - the Crew profile picture (community_profiles.avatar_path): optional, any
 *     picture at all, shown to the crew. Its only rule here is an occasional,
 *     dismissible reminder for people who haven't added one.
 *   - the account headshot (clients.profile_picture_url): a coaching client's
 *     private photo for their coach, taken live, checked, then accepted by their
 *     coach or an admin. Nothing in here ever copies one into the other.
 *
 * Reminders for an outstanding headshot follow one schedule from when it was
 * asked for (the initial request, then 3, 7 and 14 days, then every 14), the
 * admin's to change. A request reads the same to the client whoever asked and
 * why: a standard JF Effect account update, never a person's name or reason.
 */

export const DAY_MS = 86_400_000;

/* ---- statuses -------------------------------------------------------- */

/** What staff see: one word for where a client's headshot stands. */
export type HeadshotStatus = "missing" | "previous" | "pending" | "verified" | "retake_requested";

export const HEADSHOT_STATUS_LABEL: Record<HeadshotStatus, string> = {
  missing: "Missing",
  previous: "Previously submitted",
  pending: "Pending review",
  verified: "Verified",
  retake_requested: "Retake requested",
};

/** Calm by default; amber only where someone has to act. */
export const HEADSHOT_STATUS_TONE: Record<HeadshotStatus, "neutral" | "good" | "attention"> = {
  missing: "attention",
  previous: "neutral",
  pending: "attention",
  verified: "good",
  retake_requested: "attention",
};

export type RequestKind = "onboarding" | "manual" | "review";

export type StatusInput = {
  /** clients.profile_picture_url */
  displayPath: string | null;
  /** the accepted headshot's display path, when one was accepted through this system */
  acceptedDisplayPath: string | null;
  /** a submission waiting for review */
  pending: boolean;
  /** the open request, if any */
  openRequest: { kind: RequestKind } | null;
};

/**
 * Pending review wins (the client did their part); then an open retake request;
 * then whether there's a photo at all, and whether it's one this system accepted
 * (verified) or one from before it (previously submitted, grandfathered).
 */
export function headshotStatus(i: StatusInput): HeadshotStatus {
  if (i.pending) return "pending";
  if (i.openRequest && i.openRequest.kind !== "onboarding") return "retake_requested";
  if (!i.displayPath) return "missing";
  if (i.acceptedDisplayPath && i.acceptedDisplayPath === i.displayPath) return "verified";
  return "previous";
}

/** Does the client have something to do? Only an open request they haven't answered yet. */
export function headshotOutstanding(i: { pending: boolean; openRequest: { kind: RequestKind } | null }): boolean {
  return !i.pending && !!i.openRequest;
}

/* ---- the client's words (one standard, whoever asked) --------------- */

export const HEADSHOT_COPY = {
  /** a staff request, or a submission that wasn't accepted: never says who or why */
  update: {
    title: "Account headshot update required",
    body: "Please update your account headshot to ensure your profile meets our account photo standards. This only takes a moment and can be completed whenever you're ready.",
  },
  /** a new client who hasn't added one yet */
  missing: {
    title: "Account headshot required",
    body: "Please add your account headshot so your coach can recognize you and your account stays secure. This only takes a moment and can be completed whenever you're ready.",
  },
  pending: "Submitted. Your coach will review it soon.",
  action: "Update headshot",
  addAction: "Add headshot",
  later: "Remind me later",
} as const;

export function clientCopyFor(kind: RequestKind): { title: string; body: string; action: string } {
  return kind === "onboarding"
    ? { ...HEADSHOT_COPY.missing, action: HEADSHOT_COPY.addAction }
    : { ...HEADSHOT_COPY.update, action: HEADSHOT_COPY.action };
}

export const CREW_PHOTO_COPY = {
  title: "Make your Crew profile yours!",
  body: "Upload any picture you want. It doesn't have to be you.",
  action: "Add a picture",
  later: "Not now",
} as const;

/* ---- settings -------------------------------------------------------- */

export type PhotoReminderSettings = {
  headshot: {
    enabled: boolean;
    /** follow-ups after the initial request, in days from it */
    followUpDays: number[];
    /** then every N days (0 = no more) */
    repeatDays: number;
    /** clients made on or after this are asked as part of onboarding (ISO); null = nobody automatically */
    requiredSince: string | null;
  };
  crew: {
    enabled: boolean;
    firstDays: number;
    secondDays: number;
    /** then every N days (0 = no more) */
    repeatDays: number;
  };
  /** evidence frames are deleted this many days after a decision (7–30; the Privacy Policy says 30) */
  evidenceRetentionDays: number;
};

export const DEFAULT_PHOTO_REMINDERS: PhotoReminderSettings = {
  headshot: { enabled: true, followUpDays: [3, 7, 14], repeatDays: 14, requiredSince: null },
  crew: { enabled: true, firstDays: 7, secondDays: 14, repeatDays: 30 },
  evidenceRetentionDays: 30,
};

const int = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(n)));
};

/** Whatever is stored (or sent by the settings form), made safe. Accepts snake or camel case. */
export function sanitizePhotoReminders(raw: unknown): PhotoReminderSettings {
  let v: any = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      v = null;
    }
  }
  const h = (v && typeof v === "object" ? v.headshot : null) ?? {};
  const c = (v && typeof v === "object" ? v.crew : null) ?? {};
  const followRaw = Array.isArray(h.followUpDays ?? h.follow_up_days) ? (h.followUpDays ?? h.follow_up_days) : DEFAULT_PHOTO_REMINDERS.headshot.followUpDays;
  const followUpDays = [...new Set((followRaw as unknown[]).map((d) => int(d, 1, 90, -1)).filter((d) => d > 0))].sort((a, b) => a - b).slice(0, 6);
  const repeatRaw = h.repeatDays ?? h.repeat_days;
  const repeatDays = repeatRaw === 0 || repeatRaw === "0" ? 0 : int(repeatRaw, 3, 90, DEFAULT_PHOTO_REMINDERS.headshot.repeatDays);
  const since = h.requiredSince ?? h.required_since;
  const requiredSince = typeof since === "string" && !Number.isNaN(Date.parse(since)) ? new Date(since).toISOString() : null;
  const firstDays = int(c.firstDays ?? c.first_days, 1, 90, DEFAULT_PHOTO_REMINDERS.crew.firstDays);
  const secondDays = Math.max(firstDays + 1, int(c.secondDays ?? c.second_days, 2, 180, DEFAULT_PHOTO_REMINDERS.crew.secondDays));
  const crewRepeatRaw = c.repeatDays ?? c.repeat_days;
  const crewRepeat = crewRepeatRaw === 0 || crewRepeatRaw === "0" ? 0 : int(crewRepeatRaw, 7, 180, DEFAULT_PHOTO_REMINDERS.crew.repeatDays);
  return {
    headshot: {
      enabled: (h.enabled ?? true) !== false,
      followUpDays: followUpDays.length ? followUpDays : [],
      repeatDays,
      requiredSince,
    },
    crew: { enabled: (c.enabled ?? true) !== false, firstDays, secondDays, repeatDays: crewRepeat },
    evidenceRetentionDays: int(v?.evidenceRetentionDays ?? v?.evidence_retention_days, 7, 30, 30),
  };
}

/** The stored form (snake case, as the migration wrote it). */
export function storedPhotoReminders(s: PhotoReminderSettings): Record<string, unknown> {
  return {
    headshot: {
      enabled: s.headshot.enabled,
      follow_up_days: s.headshot.followUpDays,
      repeat_days: s.headshot.repeatDays,
      required_since: s.headshot.requiredSince,
    },
    crew: { enabled: s.crew.enabled, first_days: s.crew.firstDays, second_days: s.crew.secondDays, repeat_days: s.crew.repeatDays },
    evidence_retention_days: s.evidenceRetentionDays,
  };
}

/** "Initial request, then 3, 7 and 14 days, then every 14" in words, for the settings card. */
export function headshotScheduleWords(s: PhotoReminderSettings["headshot"]): string {
  if (!s.enabled) return "Off: nobody is reminded (requests still show in their account)";
  const days = s.followUpDays;
  const list = days.length === 0 ? "" : days.length === 1 ? `${days[0]}` : `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}`;
  const parts = ["The request"];
  if (list) parts.push(`then after ${list} day${days.length === 1 && days[0] === 1 ? "" : "s"}`);
  if (s.repeatDays > 0) parts.push(`then every ${s.repeatDays} days`);
  return parts.join(", ") + " until it's done";
}

export function crewScheduleWords(s: PhotoReminderSettings["crew"]): string {
  if (!s.enabled) return "Off";
  const base = `After ${s.firstDays} days, then ${s.secondDays} days`;
  return s.repeatDays > 0 ? `${base}, then every ${s.repeatDays} days` : base;
}

/* ---- the headshot reminder schedule ---------------------------------- */

/**
 * The moments a reminder is due, as offsets in days from the request: the
 * request itself (0), the follow-ups, then every `repeatDays` after the last.
 * Capped so a schedule can never be read forever.
 */
export function headshotPointDays(s: PhotoReminderSettings["headshot"], upToDays: number): number[] {
  const out = [0, ...s.followUpDays.filter((d) => d > 0)];
  let last = out[out.length - 1]!;
  if (s.repeatDays > 0) {
    for (let i = 0; i < 400 && last + s.repeatDays <= upToDays; i++) {
      last += s.repeatDays;
      out.push(last);
    }
  }
  return out.filter((d) => d <= upToDays);
}

/** How many reminder moments have come by now (the request itself counts as the first). */
export function headshotPointsDue(openedAt: Date, now: Date, s: PhotoReminderSettings["headshot"]): number {
  const elapsed = (now.getTime() - openedAt.getTime()) / DAY_MS;
  if (elapsed < 0) return 0;
  return headshotPointDays(s, elapsed).length;
}

/** The next reminder moment strictly after `now`, or null when the schedule has run out. */
export function nextHeadshotPoint(openedAt: Date, now: Date, s: PhotoReminderSettings["headshot"]): Date | null {
  const elapsed = (now.getTime() - openedAt.getTime()) / DAY_MS;
  const ahead = headshotPointDays(s, Math.max(0, elapsed) + Math.max(s.repeatDays, 90) + 1).find((d) => d > elapsed + 1e-9);
  return ahead === undefined ? null : new Date(openedAt.getTime() + ahead * DAY_MS);
}

export type ReminderState = {
  openedAt: Date;
  remindersSent: number;
  snoozedUntil: Date | null;
};

/** Should the hourly tick send a reminder push now? One per moment, never while snoozed, never a backlog. */
export function shouldSendHeadshotReminder(r: ReminderState, now: Date, s: PhotoReminderSettings["headshot"]): boolean {
  if (!s.enabled) return false;
  if (r.snoozedUntil && r.snoozedUntil.getTime() > now.getTime()) return false;
  return headshotPointsDue(r.openedAt, now, s) > r.remindersSent;
}

/** "Remind me later": until the next reminder moment, never sooner than half a day. */
export function snoozeUntil(openedAt: Date, now: Date, s: PhotoReminderSettings["headshot"]): Date {
  const floor = new Date(now.getTime() + DAY_MS / 2);
  const next = nextHeadshotPoint(openedAt, now, s);
  if (!next) return new Date(now.getTime() + 14 * DAY_MS);
  return next.getTime() < floor.getTime() ? floor : next;
}

/** Is the Home card due (not snoozed)? The Account row shows regardless. */
export function headshotCardDue(r: { snoozedUntil: Date | null }, now: Date): boolean {
  return !r.snoozedUntil || r.snoozedUntil.getTime() <= now.getTime();
}

/** A push only at a sensible local hour (10 AM to 7 PM), so nobody is woken or pinged at dinner. */
export const REMINDER_HOURS = { from: 10, to: 19 } as const;
export function goodReminderHour(localHour: number): boolean {
  return localHour >= REMINDER_HOURS.from && localHour < REMINDER_HOURS.to;
}

/* ---- the Crew picture reminder schedule ------------------------------ */

/** Reminder moments in days from the account's start: first, second, then every `repeatDays`. */
export function crewPointDays(s: PhotoReminderSettings["crew"], upToDays: number): number[] {
  const out: number[] = [];
  if (s.firstDays <= upToDays) out.push(s.firstDays);
  if (s.secondDays <= upToDays) out.push(s.secondDays);
  if (s.repeatDays > 0) {
    let last = s.secondDays;
    for (let i = 0; i < 400 && last + s.repeatDays <= upToDays; i++) {
      last += s.repeatDays;
      out.push(last);
    }
  }
  return out;
}

/** The latest Crew reminder moment that has come (null before the first). */
export function latestCrewPoint(start: Date, now: Date, s: PhotoReminderSettings["crew"]): Date | null {
  const elapsed = (now.getTime() - start.getTime()) / DAY_MS;
  const pts = crewPointDays(s, elapsed);
  const last = pts[pts.length - 1];
  return last === undefined ? null : new Date(start.getTime() + last * DAY_MS);
}

/**
 * Show the Crew picture reminder? Only someone with no Crew picture, at a moment
 * that has come, and not dismissed since that moment. Dismissing hides it until
 * the next moment; adding a picture ends it for good.
 */
export function crewReminderDue(i: {
  hasCrewPicture: boolean;
  accountStart: Date;
  dismissedAt: Date | null;
  now: Date;
  settings: PhotoReminderSettings["crew"];
}): boolean {
  if (!i.settings.enabled || i.hasCrewPicture) return false;
  const point = latestCrewPoint(i.accountStart, i.now, i.settings);
  if (!point) return false;
  return !i.dismissedAt || i.dismissedAt.getTime() < point.getTime();
}

/* ---- the capture challenge ------------------------------------------- */

export type ChallengeStep = "blink" | "turn_left" | "turn_right";

/**
 * The server's random order for a guided capture: a blink (which a printed or
 * on-screen still photo can't do) and one slight head turn, in either order.
 */
export function pickChallenge(rand: () => number = Math.random): ChallengeStep[] {
  const turn: ChallengeStep = rand() < 0.5 ? "turn_left" : "turn_right";
  return rand() < 0.5 ? ["blink", turn] : [turn, "blink"];
}

export const CHALLENGE_WORDS: Record<ChallengeStep, string> = {
  blink: "Blink slowly",
  turn_left: "Turn your head slightly left",
  turn_right: "Turn your head slightly right",
};

/** How long a capture session stays open, and how many a client can start in an hour. */
export const SESSION_TTL_MS = 8 * 60_000;
export const SESSIONS_PER_HOUR = 15;
/** The consent wording's version, kept on each guided capture. */
export const HEADSHOT_CONSENT_VERSION = "headshot-2026-11-26";
