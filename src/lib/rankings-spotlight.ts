/**
 * Crew → Rankings spotlight: the top three of every board, one podium at a
 * time, at the top of the page. Built only from the boards' own rows (the same
 * queries), so a podium here never disagrees with the board it opens.
 */
import { rankedRows, type StandingRow } from "@/lib/league-standing";
import { formatLeaguePoints } from "@/lib/league-points";
import { monthName } from "@/lib/league-recap";
import { formatMultiple, pickBoard, type Division, type StrengthRow } from "@/lib/strength-board";

/** How long each podium stays up before the next (time to read three names, not to wait). */
export const SPOTLIGHT_MS = 5000;
/** After a swipe or a dot tap, the spotlight stays on what you picked this long. */
export const SPOTLIGHT_HOLD_MS = 10_000;
/** Remembered on this device when someone pauses it. */
export const SPOTLIGHT_PAUSED_KEY = "jf-rankings-spotlight-paused";

export type SpotlightKey = "monthly" | "strength" | "competition" | "fame";

export type SpotlightPerson = { id: string; name: string; avatar_url: string | null; value: string; me: boolean };

export type SpotlightSlide = {
  key: SpotlightKey;
  title: string;
  /** What the numbers are ("Live · points", "Men · pound for pound"). */
  sub: string;
  /** 1st, 2nd, 3rd (fewer when the board has fewer). */
  people: SpotlightPerson[];
};

type LeagueRow = StandingRow & { avatar_url: string | null };

/** "Frederick Callahan" → "Frederick C" (the boards' own style), so three names fit side by side. */
export function podiumName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Athlete";
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  return last ? `${parts[0]} ${last[0].toUpperCase()}` : parts[0];
}

const DIVISION_WORD: Record<Division, string> = { all: "Everyone", male: "Men", female: "Women" };

function leaguePodium(rows: LeagueRow[]): SpotlightPerson[] {
  return rankedRows(rows).slice(0, 3).map((r) => ({
    id: r.client_id,
    name: podiumName(r.display_name),
    avatar_url: r.avatar_url,
    value: `${formatLeaguePoints(r.total_points)} pts`,
    me: r.is_me,
  }));
}

function strengthPodium(rows: StrengthRow[], division: Division): SpotlightPerson[] {
  return pickBoard(rows, "p4p", "total", division, 3).top.map((r) => ({
    id: r.key,
    name: podiumName(r.display_name),
    avatar_url: r.avatar_url,
    value: `${formatMultiple(r.bw_multiple) ?? "—"} BW`,
    me: r.is_me,
  }));
}

/**
 * The podiums, in order: this month's League (live), the Hall of Strength and
 * the Competition record (pound for pound, total, the viewer's division, the
 * boards' own default), then the Hall of Fame (last month's champions). A
 * board nobody is ranked on yet is left out.
 */
export function spotlightSlides(input: {
  monthly: LeagueRow[];
  previous: LeagueRow[];
  strength: StrengthRow[];
  meets: StrengthRow[];
  division: Division;
  monthStart: string;
  previousMonthStart: string;
}): SpotlightSlide[] {
  const word = DIVISION_WORD[input.division];
  const slides: SpotlightSlide[] = [
    { key: "monthly", title: `${monthName(input.monthStart)} League`, sub: "Live · points this month", people: leaguePodium(input.monthly) },
    { key: "strength", title: "Hall of Strength", sub: `${word} · pound for pound`, people: strengthPodium(input.strength, input.division) },
    { key: "competition", title: "Competition record", sub: `${word} · sanctioned meets`, people: strengthPodium(input.meets, input.division) },
    { key: "fame", title: "Hall of Fame", sub: `${monthName(input.previousMonthStart)} champions`, people: leaguePodium(input.previous) },
  ];
  return slides.filter((s) => s.people.length > 0);
}
