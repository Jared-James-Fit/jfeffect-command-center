/**
 * Live challenges: the shapes the database functions return, and the pure
 * rules every screen shares (score formatting, lifecycle, presets, captions).
 * Ranking itself lives in the database (`_challenge_rank`), never here, so a
 * phone can't disagree with the leaderboard.
 */

export type ChallengeStatus =
  | "draft"
  | "upcoming"
  | "live"
  | "paused"
  | "verifying"
  | "completed"
  | "archived"
  | "cancelled";
export type Measure = "reps" | "weight" | "time" | "distance" | "points";
export type Direction = "higher" | "lower";
export type Unit = "reps" | "lb" | "kg" | "s" | "m" | "km" | "pts";
export type Tiebreak = "shared" | "lighter" | "runoff";
export type StaffRole = "admin" | "manager" | "judge" | "registration";
export type CollectLevel = "off" | "optional" | "required";

export type ChallengeCard = {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  status: ChallengeStatus;
  activity: string;
  measure: Measure;
  direction: Direction;
  unit: Unit;
  aggregate: "best" | "sum";
  attempts_allowed: number;
  relative: boolean;
  load_label: string | null;
  objective: string | null;
  tiebreak: Tiebreak;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
  venue_name: string | null;
  city: string | null;
  cover_path: string | null;
  prize_summary: string | null;
  entry_fee_label: string | null;
  is_test: boolean;
  final: boolean;
  results_final_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  separate_divisions: boolean;
};

export type Division = { id: string; name: string; load_label: string | null };
export type Sponsor = {
  id?: string;
  name: string;
  url?: string | null;
  logo_path: string | null;
  blurb?: string | null;
};
export type PublicPrize = {
  place: number;
  title: string;
  value_cents: number | null;
  division_id: string | null;
  sponsor: string | null;
  winner: { name: string; code: string; photo: string | null } | null;
};

export type ChallengePublic = ChallengeCard & {
  description: string | null;
  address: string | null;
  max_participants: number | null;
  min_age: number;
  eligibility: string | null;
  rules: string[];
  safety: string | null;
  warmup: string | null;
  self_registration: boolean;
  collect: { phone?: CollectLevel; instagram?: CollectLevel };
  acknowledgments: string[];
  announcement: string | null;
  announcement_at: string | null;
  my_role: StaffRole | null;
  /** The signed-in person's own entry here ("Find my ranking"); never anyone else's. */
  my_code?: string | null;
  registration_opens_at?: string | null;
  registration_closes_at?: string | null;
  /** Self sign-up is open right now (status, window and spots), as the database decides it. */
  registration_open?: boolean;
  version: number | null;
  registered: number;
  divisions: Division[];
  sponsors: Sponsor[];
  prizes: PublicPrize[];
};

export type HubChallenge = ChallengeCard & {
  registered: number;
  competed: number;
  leader: { name: string; score: number; tied: boolean; photo: string | null } | null;
};

export type BoardRow = {
  code: string;
  name: string;
  photo: string | null;
  handle: string | null;
  division_id: string | null;
  score: number;
  rank: number;
  rank_div: number;
  tied: boolean;
  tied_div: boolean;
  valid: number;
  attempts: number;
  at: string | null;
};

export type RecentAttempt = {
  id: string;
  code: string;
  name: string;
  photo: string | null;
  value: number | null;
  valid: boolean;
  attempt_no: number;
  tiebreak: boolean;
  division_id: string | null;
  at: string;
};

export type Board = {
  challenge_id: string;
  status: ChallengeStatus;
  final: boolean;
  as_of: string;
  version: number | null;
  registered: number;
  rows: BoardRow[];
  recent: RecentAttempt[];
};

export type EntryPublic = {
  challenge: ChallengeCard & { version: number | null; divisions: Division[]; sponsors: Sponsor[] };
  code: string;
  name: string;
  status: "registered" | "checked_in" | "withdrawn" | "disqualified";
  photo: string | null;
  handle: string | null;
  division_id: string | null;
  score: number | null;
  rank: number | null;
  rank_div: number | null;
  tied: boolean | null;
  tied_div: boolean | null;
  of: number;
  of_div: number;
  top: number | null;
  top_div: number | null;
  attempts: { no: number; value: number | null; valid: boolean; tiebreak: boolean; at: string }[];
  claimed: boolean;
  is_mine: boolean;
};

export type AthleteEntry = ChallengeCard & {
  code: string;
  entry_name: string;
  entry_status: EntryPublic["status"];
  division: string | null;
  score: number | null;
  rank: number | null;
  tied: boolean | null;
  of: number;
};

export type AthleteProfile = {
  handle: string;
  name: string;
  photo: string | null;
  discoverable: boolean;
  claimed: boolean;
  is_mine: boolean;
  since: string;
  entries: AthleteEntry[];
};

export type StaffAttempt = {
  id: string;
  no: number;
  value: number | null;
  valid: boolean;
  tiebreak: boolean;
  status: "verified" | "void";
  note: string | null;
  video_url: string | null;
  void_reason: string | null;
  at: string;
  replaces: string | null;
};

export type StaffEntry = {
  id: string;
  bib: number;
  code: string;
  name: string;
  status: EntryPublic["status"];
  status_reason: string | null;
  division_id: string | null;
  show_photo: boolean;
  photo: string | null;
  person_id: string | null;
  handle: string;
  claimed: boolean;
  bodyweight_kg: number | null;
  source: "staff" | "self";
  created_at: string;
  score: number | null;
  rank: number | null;
  rank_div: number | null;
  tied: boolean | null;
  tied_div: boolean | null;
  attempts: StaffAttempt[];
};

export type StaffBoard = { role: StaffRole; version: number | null; entries: StaffEntry[] };

/* ------------------------------------------------------------------ */
/*  Status                                                             */
/* ------------------------------------------------------------------ */

export const STATUS_META: Record<
  ChallengeStatus,
  { label: string; tone: "live" | "neutral" | "muted" | "warning" | "success" | "destructive" }
> = {
  draft: { label: "Draft", tone: "muted" },
  upcoming: { label: "Upcoming", tone: "neutral" },
  live: { label: "Live", tone: "live" },
  paused: { label: "Paused", tone: "warning" },
  verifying: { label: "Verifying results", tone: "warning" },
  completed: { label: "Final results", tone: "success" },
  archived: { label: "Completed", tone: "muted" },
  cancelled: { label: "Cancelled", tone: "destructive" },
};

/** Results are open to change until an admin confirms them. */
export function isResultsFinal(c: Pick<ChallengeCard, "final">): boolean {
  return !!c.final;
}

/** Scores can be entered right now (a draft allows a practice run). */
export function canRecordScores(status: ChallengeStatus): boolean {
  return status === "live" || status === "verifying" || status === "draft";
}

/** The public can sign themselves up right now. */
export function selfSignupOpen(
  c: Pick<ChallengePublic, "status" | "self_registration" | "max_participants" | "registered">,
): boolean {
  if (!c.self_registration) return false;
  if (!["upcoming", "live", "paused"].includes(c.status)) return false;
  if (c.max_participants != null && c.registered >= c.max_participants) return false;
  return true;
}

export type StatusAction = {
  to: ChallengeStatus | "finalize";
  label: string;
  need: "admin" | "manage";
  /** A sentence for the confirm dialog, when the move deserves one. */
  confirm?: string;
  tone?: "primary" | "neutral" | "destructive";
};

/** What the status buttons offer from where a challenge is (mirrors challenge_set_status). */
export function statusActions(status: ChallengeStatus): StatusAction[] {
  switch (status) {
    case "draft":
      return [
        {
          to: "upcoming",
          label: "Publish",
          need: "admin",
          tone: "primary",
          confirm: "Anyone with the link can see it, and it shows on the Challenges page.",
        },
        {
          to: "cancelled",
          label: "Cancel challenge",
          need: "admin",
          tone: "destructive",
          confirm: "It stays in your list as cancelled.",
        },
      ];
    case "upcoming":
      return [
        {
          to: "live",
          label: "Start event",
          need: "manage",
          tone: "primary",
          confirm: "The leaderboard goes live and judges can record scores.",
        },
        {
          to: "draft",
          label: "Unpublish",
          need: "admin",
          confirm: "It goes back to a draft only staff can see.",
        },
        {
          to: "cancelled",
          label: "Cancel challenge",
          need: "admin",
          tone: "destructive",
          confirm: "The page will say it's cancelled.",
        },
      ];
    case "live":
      return [
        { to: "paused", label: "Pause", need: "manage" },
        {
          to: "verifying",
          label: "End event",
          need: "manage",
          tone: "primary",
          confirm: "New scores stop. Judges can still correct scores while you check the results.",
        },
        {
          to: "cancelled",
          label: "Cancel challenge",
          need: "admin",
          tone: "destructive",
          confirm: "The page will say it's cancelled.",
        },
      ];
    case "paused":
      return [
        { to: "live", label: "Resume", need: "manage", tone: "primary" },
        {
          to: "verifying",
          label: "End event",
          need: "manage",
          confirm: "New scores stop. Judges can still correct scores while you check the results.",
        },
      ];
    case "verifying":
      return [
        {
          to: "finalize",
          label: "Confirm final results",
          need: "admin",
          tone: "primary",
          confirm: "Rankings become final, winners are named on the page and scores lock.",
        },
        { to: "live", label: "Reopen event", need: "manage" },
        { to: "cancelled", label: "Cancel challenge", need: "admin", tone: "destructive" },
      ];
    case "completed":
      return [
        {
          to: "archived",
          label: "Archive",
          need: "admin",
          confirm: "It moves to past challenges. The page and results stay up.",
        },
        {
          to: "verifying",
          label: "Reopen results",
          need: "admin",
          confirm: "Results stop being final until you confirm them again.",
        },
      ];
    case "archived":
      return [{ to: "completed", label: "Unarchive", need: "admin" }];
    case "cancelled":
      return [{ to: "draft", label: "Back to draft", need: "admin" }];
  }
}

export function roleCan(
  role: StaffRole | null | undefined,
  need: "admin" | "manage" | "judge" | "register",
): boolean {
  if (!role) return false;
  if (need === "admin") return role === "admin";
  if (need === "manage") return role === "admin" || role === "manager";
  if (need === "judge") return role === "admin" || role === "manager" || role === "judge";
  return true;
}

/** What the builder still needs before Publish works (mirrors the database). */
export function publishMissing(c: {
  starts_at: string | null;
  venue_name: string | null;
  rules: string[];
}): string[] {
  const out: string[] = [];
  if (!c.starts_at) out.push("a start date and time");
  if (!c.venue_name?.trim()) out.push("a venue");
  if (!c.rules.length) out.push("the rules");
  return out;
}

/* ------------------------------------------------------------------ */
/*  Scores                                                             */
/* ------------------------------------------------------------------ */

export type ScoreShape = Pick<ChallengeCard, "measure" | "unit" | "relative">;

const UNIT_WORD: Record<Unit, [string, string]> = {
  reps: ["rep", "reps"],
  lb: ["lb", "lb"],
  kg: ["kg", "kg"],
  s: ["sec", "sec"],
  m: ["m", "m"],
  km: ["km", "km"],
  pts: ["pt", "pts"],
};

function trimNumber(n: number, maxDecimals: number): string {
  const s = n.toFixed(maxDecimals);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/** 83.4 → "1:23.4"; 9.25 → "9.25"; 3725 → "1:02:05". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "–";
  if (seconds < 60) return trimNumber(seconds, 2);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds - h * 3600 - m * 60;
  const sec = trimNumber(s, 1);
  const secPadded = s < 10 ? `0${sec}` : sec;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${secPadded}` : `${m}:${secPadded}`;
}

/** The score's number on its own ("18", "1:23.4", "2.1×"). */
export function scoreValue(value: number | null | undefined, c: ScoreShape): string {
  if (value == null || !Number.isFinite(Number(value))) return "–";
  const v = Number(value);
  if (c.relative) return trimNumber(v, 2);
  if (c.measure === "time") return formatDuration(v);
  if (c.measure === "reps") return String(Math.round(v));
  return trimNumber(v, c.unit === "km" ? 2 : 1);
}

/** The unit word under a score ("reps", "lb", "× bodyweight"). */
export function scoreUnit(value: number | null | undefined, c: ScoreShape): string {
  if (c.relative) return "× bw";
  if (c.measure === "time") return Number(value) < 60 ? "sec" : "time";
  const [one, many] = UNIT_WORD[c.unit];
  return Number(value) === 1 ? one : many;
}

/** "18 reps", "405 lb", "1:23.4", "2.1× bodyweight". */
export function formatScore(value: number | null | undefined, c: ScoreShape): string {
  if (value == null) return "No score";
  const v = scoreValue(value, c);
  if (c.relative) return `${v}× bodyweight`;
  if (c.measure === "time" && Number(value) >= 60) return v;
  return `${v} ${scoreUnit(value, c)}`;
}

/**
 * What a judge typed → the stored number. Times take "83.4", "1:23.4" or
 * "1:02:05"; everything else a plain number. Reps must be whole.
 */
export function parseScoreInput(text: string, c: Pick<ChallengeCard, "measure">): number | null {
  const t = text.trim().replace(",", ".");
  if (!t) return null;
  if (c.measure === "time" && t.includes(":")) {
    const parts = t.split(":");
    if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
    const nums = parts.map(Number);
    let total = 0;
    for (const n of nums) total = total * 60 + n;
    return Math.round(total * 1000) / 1000;
  }
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 100000) return null;
  if (c.measure === "reps" && !Number.isInteger(n)) return null;
  return n;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/** "1st", or "T-2nd" for a shared place. */
export function placeLabel(rank: number | null | undefined, tied?: boolean | null): string {
  if (!rank) return "–";
  return `${tied ? "T-" : ""}${ordinal(rank)}`;
}

/** "#2", or "T-2". */
export function rankBadge(rank: number | null | undefined, tied?: boolean | null): string {
  if (!rank) return "–";
  return tied ? `T-${rank}` : `#${rank}`;
}

/** How far this score is from the leader, in words ("3 reps off first"). */
export function gapToFirst(
  score: number | null | undefined,
  top: number | null | undefined,
  c: ScoreShape & { direction: Direction },
): string | null {
  if (score == null || top == null) return null;
  const gap = c.direction === "higher" ? Number(top) - Number(score) : Number(score) - Number(top);
  if (gap <= 0) return null;
  if (c.relative) return `${trimNumber(gap, 2)}× bodyweight off first`;
  if (c.measure === "time") return `${formatDuration(gap)} off first`;
  return `${scoreValue(gap, c)} ${scoreUnit(gap, c)} off first`;
}

/* ------------------------------------------------------------------ */
/*  Boards                                                             */
/* ------------------------------------------------------------------ */

/** The rows of one board: everyone, or one division (ranked within it). */
export function boardRows(
  rows: BoardRow[],
  divisionId: string | null,
): (BoardRow & { place: number; shared: boolean })[] {
  if (!divisionId)
    return rows
      .map((r) => ({ ...r, place: r.rank, shared: r.tied }))
      .sort((a, b) => a.place - b.place || a.name.localeCompare(b.name));
  return rows
    .filter((r) => r.division_id === divisionId)
    .map((r) => ({ ...r, place: r.rank_div, shared: r.tied_div }))
    .sort((a, b) => a.place - b.place || a.name.localeCompare(b.name));
}

/** Which board opens first: everyone, unless divisions carry their own loads. */
export function defaultDivision(
  c: Pick<ChallengeCard, "separate_divisions"> & { divisions: Division[] },
): string | null {
  return c.separate_divisions && c.divisions.length ? c.divisions[0]!.id : null;
}

export type BoardMoment = { kind: "new_leader" | "top_three"; code: string; name: string };

/**
 * What changed between two versions of a board that's worth a moment on
 * screen: someone took first, or someone moved into the top three.
 */
export function boardMoments(prev: BoardRow[] | undefined, next: BoardRow[]): BoardMoment[] {
  if (!prev) return [];
  const before = new Map(prev.map((r) => [r.code, r.rank]));
  const prevLeaders = new Set(prev.filter((r) => r.rank === 1).map((r) => r.code));
  const out: BoardMoment[] = [];
  for (const r of next) {
    const was = before.get(r.code);
    if (r.rank === 1 && !prevLeaders.has(r.code))
      out.push({ kind: "new_leader", code: r.code, name: r.name });
    else if (r.rank <= 3 && (was == null || was > 3))
      out.push({ kind: "top_three", code: r.code, name: r.name });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Words                                                              */
/* ------------------------------------------------------------------ */

export function tiebreakText(c: Pick<ChallengeCard, "tiebreak" | "direction" | "measure">): string {
  switch (c.tiebreak) {
    case "lighter":
      return "Tied scores go to the lighter lifter (everyone's weighed at check-in; the number is never shown). Same bodyweight too? You share the place.";
    case "runoff":
      return "Tied for a prize? The tied athletes do one run-off attempt, and the better run-off wins. No run-off for everyone? You share the place.";
    default:
      return "Tied scores share the place. Nobody wins a tie for being earlier in the order.";
  }
}

export function scoringText(
  c: Pick<
    ChallengeCard,
    "measure" | "direction" | "aggregate" | "attempts_allowed" | "relative" | "unit"
  >,
): string {
  const attempts =
    c.attempts_allowed === 1 ? "One scored attempt" : `${c.attempts_allowed} scored attempts`;
  const counts =
    c.attempts_allowed === 1
      ? ""
      : c.aggregate === "sum"
        ? ", added together"
        : ", your best one counts";
  const what = c.relative
    ? "the most weight for your bodyweight wins"
    : c.measure === "time"
      ? c.direction === "lower"
        ? "the fastest time wins"
        : "the longest time wins"
      : c.measure === "reps"
        ? "the most valid reps wins"
        : c.measure === "weight"
          ? "the heaviest valid lift wins"
          : c.measure === "distance"
            ? c.direction === "lower"
              ? "the shortest distance wins"
              : "the longest distance wins"
            : c.direction === "lower"
              ? "the lowest score wins"
              : "the highest score wins";
  return `${attempts}${counts}: ${what}. Only judged, verified scores count.`;
}

/** "Sat, Nov 15 · 1:00 PM" in the event's own zone. */
export function eventWhen(
  iso: string | null,
  timeZone: string,
  opts: { withYear?: boolean } = {},
): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    const day = new Intl.DateTimeFormat("en-CA", {
      weekday: "short",
      month: "short",
      day: "numeric",
      ...(opts.withYear ? { year: "numeric" } : {}),
      timeZone,
    }).format(d);
    const time = new Intl.DateTimeFormat("en-CA", {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(d);
    return `${day} · ${time}`;
  } catch {
    return null;
  }
}

/** A short clock time ("7:42 PM") for live labels. */
export function clockTime(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

export function slugify(title: string, max = 48): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

/** First name + last initial: the default name on a board ("Jared M."). */
export function defaultBoardName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0]!.slice(0, 40);
  return `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.`.slice(0, 40);
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** The share line under a result, for captions and the share sheet. */
export function shareCaption(
  e: { name: string; score: number | null; rank: number | null; tied: boolean | null; of: number },
  c: ScoreShape & Pick<ChallengeCard, "title" | "load_label" | "final" | "city" | "measure">,
  url: string,
): string {
  if (e.score == null) return `I'm in the ${c.title}. Come watch, or jump in yourself: ${url}`;
  const what =
    c.measure === "reps" && c.load_label
      ? `${c.load_label} for ${formatScore(e.score, c)}`
      : formatScore(e.score, c);
  const where = e.rank
    ? c.final
      ? `Finished ${placeLabel(e.rank, e.tied)} of ${e.of}`
      : `Currently ${rankBadge(e.rank, e.tied)} of ${e.of}`
    : "";
  return [`${what} at the ${c.title}.`, where ? `${where}.` : "", "Think you can beat me?", url]
    .filter(Boolean)
    .join(" ");
}

/* ------------------------------------------------------------------ */
/*  Presets (the builder's "start from")                               */
/* ------------------------------------------------------------------ */

export type ChallengePreset = {
  key: string;
  label: string;
  hint: string;
  activity: string;
  measure: Measure;
  direction: Direction;
  unit: Unit;
  aggregate: "best" | "sum";
  attempts_allowed: number;
  relative: boolean;
  load_label: string | null;
  objective: string;
  tiebreak: Tiebreak;
  rules: string[];
};

export const PRESETS: ChallengePreset[] = [
  {
    key: "max_reps_load",
    label: "Max reps at a set weight",
    hint: "Bench 225 for reps, squat 315 for reps",
    activity: "Barbell bench press",
    measure: "reps",
    direction: "higher",
    unit: "reps",
    aggregate: "best",
    attempts_allowed: 1,
    relative: false,
    load_label: "225 lb",
    objective: "Most valid reps in one continuous set",
    tiebreak: "lighter",
    rules: [
      "Every rep is judged to full range of motion.",
      "No bouncing or resting the bar between reps.",
      "No help from a spotter during scored reps.",
      "The judge decides whether each rep counts.",
    ],
  },
  {
    key: "max_weight",
    label: "Heaviest lift",
    hint: "Deadlift max, strict press max",
    activity: "Deadlift",
    measure: "weight",
    direction: "higher",
    unit: "lb",
    aggregate: "best",
    attempts_allowed: 3,
    relative: false,
    load_label: null,
    objective: "Heaviest valid lift in three attempts",
    tiebreak: "lighter",
    rules: [
      "Three attempts; your best valid lift counts.",
      "The judge's call on each attempt is final.",
      "Weight can't go down between attempts.",
    ],
  },
  {
    key: "relative_strength",
    label: "Strongest for their size",
    hint: "Heaviest lift divided by bodyweight",
    activity: "Deadlift",
    measure: "weight",
    direction: "higher",
    unit: "lb",
    aggregate: "best",
    attempts_allowed: 3,
    relative: true,
    load_label: null,
    objective: "Most weight lifted for your bodyweight",
    tiebreak: "shared",
    rules: [
      "Everyone's weighed before they lift.",
      "Three attempts; your best valid lift counts.",
      "Score = best lift ÷ bodyweight.",
    ],
  },
  {
    key: "bodyweight_reps",
    label: "Bodyweight reps",
    hint: "Pull-ups, push-ups, dips",
    activity: "Strict pull-up",
    measure: "reps",
    direction: "higher",
    unit: "reps",
    aggregate: "best",
    attempts_allowed: 1,
    relative: false,
    load_label: null,
    objective: "Most strict reps in one set",
    tiebreak: "shared",
    rules: [
      "Start from a dead hang with arms straight.",
      "Chin over the bar on every rep.",
      "No kipping or swinging.",
      "The set ends when you let go.",
    ],
  },
  {
    key: "longest_hold",
    label: "Longest hold",
    hint: "Dead hang, plank, farmer's hold",
    activity: "Dead hang",
    measure: "time",
    direction: "higher",
    unit: "s",
    aggregate: "best",
    attempts_allowed: 1,
    relative: false,
    load_label: null,
    objective: "Longest hold wins",
    tiebreak: "shared",
    rules: [
      "The clock starts when your feet leave the ground.",
      "The clock stops when you let go or touch down.",
      "No straps or chalk-free grips beyond what's provided.",
    ],
  },
  {
    key: "fastest_time",
    label: "Fastest time",
    hint: "500 m row, obstacle course, carry for time",
    activity: "500 m row",
    measure: "time",
    direction: "lower",
    unit: "s",
    aggregate: "best",
    attempts_allowed: 1,
    relative: false,
    load_label: null,
    objective: "Fastest time wins",
    tiebreak: "shared",
    rules: [
      "The clock starts on the judge's go.",
      "Your time is taken when you finish the full course.",
    ],
  },
  {
    key: "max_distance",
    label: "Longest distance",
    hint: "Farmer's carry for distance, max row in 2 minutes",
    activity: "Farmer's carry",
    measure: "distance",
    direction: "higher",
    unit: "m",
    aggregate: "best",
    attempts_allowed: 1,
    relative: false,
    load_label: null,
    objective: "Longest distance wins",
    tiebreak: "shared",
    rules: [
      "Distance is measured where the implements first touch down.",
      "No re-gripping on the ground.",
    ],
  },
  {
    key: "custom",
    label: "Something else",
    hint: "Points, a custom event, your own rules",
    activity: "Custom event",
    measure: "points",
    direction: "higher",
    unit: "pts",
    aggregate: "best",
    attempts_allowed: 1,
    relative: false,
    load_label: null,
    objective: "Highest score wins",
    tiebreak: "shared",
    rules: [],
  },
];

/** The units that make sense for a measure (the builder only offers these). */
export function unitsFor(measure: Measure): Unit[] {
  switch (measure) {
    case "reps":
      return ["reps"];
    case "weight":
      return ["lb", "kg"];
    case "time":
      return ["s"];
    case "distance":
      return ["m", "km"];
    default:
      return ["pts"];
  }
}

/** The way a measure usually wins (suggested when the measure changes). */
export function defaultDirection(measure: Measure, current?: Direction): Direction {
  if (measure === "time") return current ?? "lower";
  return "higher";
}

export const DEFAULT_ACKNOWLEDGMENTS = [
  "I'm 18 or older.",
  "I've read the rules and the safety plan, and I'm experienced enough to do this safely.",
  "I take part at my own risk and will stop the moment a judge or spotter tells me to.",
];

/* ------------------------------------------------------------------ */
/*  Achievements on a profile (computed from real results only)        */
/* ------------------------------------------------------------------ */

export type Achievement = { key: string; label: string; detail: string };

export function achievementsFor(entries: AthleteEntry[]): Achievement[] {
  const scored = entries.filter((e) => e.score != null && e.entry_status !== "disqualified");
  const finals = scored.filter((e) => e.final);
  const wins = finals.filter((e) => e.rank === 1);
  const podiums = finals.filter((e) => e.rank != null && e.rank <= 3);
  const out: Achievement[] = [];
  if (wins.length)
    out.push({
      key: "winner",
      label: wins.length > 1 ? `${wins.length}× champion` : "Champion",
      detail: wins.map((w) => w.title).join(", "),
    });
  if (podiums.length)
    out.push({
      key: "podium",
      label: podiums.length > 1 ? `${podiums.length} podiums` : "Podium finish",
      detail: podiums.map((p) => `${ordinal(p.rank!)} · ${p.title}`).join(", "),
    });
  if (scored.length >= 3)
    out.push({
      key: "regular",
      label: `${scored.length} challenges`,
      detail: "Showed up and competed",
    });
  else if (scored.length >= 1)
    out.push({
      key: "competitor",
      label: "Competitor",
      detail: `First challenge: ${scored[scored.length - 1]!.title}`,
    });
  return out;
}

/** Best score per activity (+ how it was measured), for a profile's bests. */
export function personalBests(entries: AthleteEntry[]): {
  activity: string;
  label: string;
  score: number;
  shape: ScoreShape & { direction: Direction };
  title: string;
  slug: string;
}[] {
  const best = new Map<
    string,
    {
      activity: string;
      label: string;
      score: number;
      shape: ScoreShape & { direction: Direction };
      title: string;
      slug: string;
    }
  >();
  for (const e of entries) {
    if (e.score == null || e.entry_status === "disqualified") continue;
    const key = `${e.activity.toLowerCase()}|${e.measure}|${e.unit}|${e.relative}|${e.load_label ?? ""}`;
    const label =
      e.load_label && e.measure === "reps" ? `${e.activity} · ${e.load_label}` : e.activity;
    const cur = best.get(key);
    const better = !cur || (e.direction === "higher" ? e.score > cur.score : e.score < cur.score);
    if (better)
      best.set(key, {
        activity: e.activity,
        label,
        score: Number(e.score),
        shape: { measure: e.measure, unit: e.unit, relative: e.relative, direction: e.direction },
        title: e.title,
        slug: e.slug,
      });
  }
  return [...best.values()];
}
