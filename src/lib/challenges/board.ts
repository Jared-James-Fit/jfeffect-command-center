/**
 * The leaderboard-first pages: the shapes the paged board, search, "find my
 * ranking" and "on the platform" functions return, and the pure rules the
 * screens share (what the page's main button does, gaps in words, merging
 * pages). Ranking itself stays in the database (`_challenge_rank`).
 */
import {
  formatDuration,
  ordinal,
  scoreUnit,
  scoreValue,
  selfSignupOpen,
  type BoardRow,
  type ChallengePublic,
  type ChallengeStatus,
  type Direction,
  type RecentAttempt,
  type ScoreShape,
} from "@/lib/challenges/model";

/** A board row as the paged / search / around functions return it. */
export type RankRow = Omit<BoardRow, "score" | "rank" | "rank_div" | "tied" | "tied_div"> & {
  bib: number;
  score: number | null;
  rank: number | null;
  rank_div: number | null;
  tied: boolean | null;
  tied_div: boolean | null;
  /** The place on the board being viewed (everyone, or within a division). */
  place?: number | null;
  shared?: boolean | null;
  /** 1-based position in board order (ties broken by name for display only). */
  pos?: number;
  division?: string | null;
};

export type BoardPage = {
  challenge_id: string;
  status: ChallengeStatus;
  final: boolean;
  as_of: string;
  version: number | null;
  registered: number;
  total: number;
  offset: number;
  limit: number;
  rows: RankRow[];
  recent: RecentAttempt[];
};

export type Around = {
  division_id: string | null;
  total: number;
  me: RankRow;
  offset: number | null;
  rows: RankRow[];
  next: { code: string; name: string; score: number; place: number } | null;
};

export type OnPlatform = {
  code: string;
  name: string;
  bib: number;
  photo: string | null;
  division_id: string | null;
  live_value: number | null;
  started_at: string;
  updated_at: string;
  attempt_no: number;
};

export type DashboardActivity = {
  at: string;
  action: string;
  entity: string;
  name: string | null;
  value: number | null;
  valid: boolean | null;
  to: string | null;
  change_status: string | null;
  tiebreak: boolean | null;
  reason: string | null;
  source: string | null;
  by: string | null;
};

export type Dashboard = {
  version: number | null;
  registered: number;
  checked_in: number;
  scored: number;
  waiting: number;
  prizes: number;
  prizes_open: number;
  staff: number;
  leaders: { name: string; code: string; score: number; tied: boolean; photo: string | null }[];
  recent: DashboardActivity[];
};

export const BOARD_PAGE_SIZE = 50;

/** The place on the board being viewed. */
export function placeOf(r: RankRow, division: string | null): number | null {
  if (r.place != null) return r.place;
  return division ? r.rank_div : r.rank;
}
export function sharedOf(r: RankRow, division: string | null): boolean {
  if (r.shared != null) return r.shared;
  return !!(division ? r.tied_div : r.tied);
}

/**
 * Pages of the board as one list: in board order, each athlete once (a score
 * landing between two page loads can move someone across a page edge).
 */
export function mergePages(pages: (BoardPage | null | undefined)[]): RankRow[] {
  const seen = new Set<string>();
  const out: RankRow[] = [];
  for (const p of pages) {
    if (!p) continue;
    for (const r of p.rows) {
      if (seen.has(r.code)) continue;
      seen.add(r.code);
      out.push(r);
    }
  }
  return out;
}

/** True while what the board shows can still change. */
export function isProvisional(c: { status: ChallengeStatus; final: boolean }): boolean {
  return !c.final && ["live", "paused", "verifying"].includes(c.status);
}

/** The board is worth showing (a staff member also sees a draft's practice board). */
export function hasBoard(c: { status: ChallengeStatus; my_role?: string | null }): boolean {
  if (c.status === "draft") return !!c.my_role;
  return ["live", "paused", "verifying", "completed", "archived"].includes(c.status);
}

export type PrimaryAction =
  | { kind: "find_me"; label: string; code: string }
  | { kind: "my_entry"; label: string; code: string }
  | { kind: "register"; label: string }
  | { kind: "rankings"; label: string }
  | { kind: "final"; label: string }
  | { kind: "none" };

/**
 * The one main button at the top of a challenge's page, from where the event
 * is and whether this phone / login has an entry in it. Never from a name the
 * viewer typed: "find my ranking" needs their own entry.
 */
export function primaryAction(
  c: Pick<
    ChallengePublic,
    "status" | "final" | "self_registration" | "max_participants" | "registered"
  > & { my_role?: string | null; registration_open?: boolean },
  mine: string | null,
): PrimaryAction {
  if (c.status === "cancelled") return { kind: "none" };
  const board = hasBoard(c);
  if (mine) {
    return board
      ? { kind: "find_me", label: "Find my ranking", code: mine }
      : { kind: "my_entry", label: "You're registered", code: mine };
  }
  const open = c.registration_open ?? selfSignupOpen(c);
  if (open) return { kind: "register", label: "Register" };
  if (c.final || c.status === "completed" || c.status === "archived")
    return { kind: "final", label: "View final results" };
  if (board) return { kind: "rankings", label: "View rankings" };
  return { kind: "none" };
}

/** A gap between two scores in words ("3 reps", "12.5 lb", "0:04.2"). */
export function gapText(a: number, b: number, c: ScoreShape): string {
  const gap = Math.abs(Number(a) - Number(b));
  if (c.relative) return `${Number(gap.toFixed(2))}× bodyweight`;
  if (c.measure === "time") return gap < 60 ? `${formatDuration(gap)} sec` : formatDuration(gap);
  return `${scoreValue(gap, c)} ${scoreUnit(gap, c)}`;
}

/**
 * Where an athlete stands, in one line: "Leading", "Tied for 3rd",
 * "3 reps behind 2nd (Kim L.)". Null when they have no score.
 */
export function standingLine(
  me: Pick<RankRow, "score" | "name">,
  place: number | null,
  shared: boolean,
  next: Around["next"],
  c: ScoreShape & { direction: Direction },
): string | null {
  if (me.score == null || place == null) return null;
  if (place === 1) return shared ? "Tied for 1st" : "Leading";
  const where = shared ? `Tied for ${ordinal(place)}` : null;
  if (!next) return where;
  const behind = `${gapText(next.score, me.score, c)} behind ${ordinal(next.place)} (${next.name})`;
  return where ? `${where} · ${behind}` : behind;
}

/** "42 athletes" / "1 athlete" */
export function athletes(n: number): string {
  return `${n.toLocaleString("en-CA")} ${n === 1 ? "athlete" : "athletes"}`;
}

/** The judge's live count is shown only while it's fresh (a dropped phone leaves no ghost). */
export const ON_PLATFORM_FRESH_MS = 15 * 60_000;
export function isFresh(n: Pick<OnPlatform, "updated_at"> | null | undefined, now: number) {
  return !!n && now - new Date(n.updated_at).getTime() < ON_PLATFORM_FRESH_MS;
}

/** What the dashboard's activity line says ("Score: 18 reps · Jared M."). */
export function activityText(a: DashboardActivity, shape: ScoreShape): string {
  const who = a.name ? ` · ${a.name}` : "";
  const value = (v: number | null, valid: boolean | null) =>
    valid === false ? "no valid score" : v == null ? "" : `${scoreValue(v, shape)} ${scoreUnit(v, shape)}`;
  switch (a.action) {
    case "register":
      return `${a.source === "staff" ? "Registered at the desk" : "Signed up"}${who}`;
    case "reregister":
      return `Registered again${who}`;
    case "record":
      return `${a.tiebreak ? "Run-off" : "Score"}: ${value(a.value, a.valid)}${who}`;
    case "correct":
      return `Score corrected to ${value(a.value, a.valid)}${a.reason ? ` (${a.reason})` : ""}${who}`;
    case "void":
      return `Score removed${a.reason ? ` (${a.reason})` : ""}${who}`;
    case "status":
      return `Event ${a.to ? statusWord(a.to) : "updated"}`;
    case "finalize":
      return "Results confirmed";
    case "update":
      return a.change_status === "checked_in"
        ? `Checked in${who}`
        : a.change_status === "withdrawn"
          ? `Withdrew${who}`
          : a.change_status === "disqualified"
            ? `Disqualified${who}`
            : a.change_status === "registered"
              ? `Reinstated${who}`
              : `Athlete details changed${who}`;
    case "delete":
      return "Entry deleted";
    case "staff_add":
      return "Team member added";
    case "staff_remove":
      return "Team member removed";
    case "reset_practice":
      return "Practice run cleared";
    case "duplicate":
      return "Created from a copy";
    default:
      return `${a.action.replace(/_/g, " ")}${who}`;
  }
}

function statusWord(s: string): string {
  switch (s) {
    case "upcoming":
      return "published";
    case "live":
      return "started";
    case "paused":
      return "paused";
    case "verifying":
      return "ended";
    case "completed":
      return "completed";
    case "archived":
      return "archived";
    case "cancelled":
      return "cancelled";
    case "draft":
      return "unpublished";
    default:
      return s;
  }
}
