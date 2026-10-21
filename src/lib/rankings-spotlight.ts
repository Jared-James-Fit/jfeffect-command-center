/**
 * Crew → Rankings spotlight: the top three of every board, one podium at a
 * time, at the top of the page. Built only from the boards' own rows (the same
 * queries), so a podium here never disagrees with the board it opens.
 */
import { rankedRows, type StandingRow } from "@/lib/league-standing";
import { formatLeaguePoints } from "@/lib/league-points";
import { monthName } from "@/lib/league-recap";
import { formatLoad, formatMultiple, pickBoard, type BoardMode, type Division, type Sex, type StrengthRow } from "@/lib/strength-board";
import type { WeightUnit } from "@/lib/weight-lifted";

/** How long each podium stays up before the next (time to read three names, not to wait). */
export const SPOTLIGHT_MS = 3500;
/** After a swipe or a dot tap, the spotlight stays on what you picked this long. */
export const SPOTLIGHT_HOLD_MS = 10_000;
/** Remembered on this device when someone pauses it. */
export const SPOTLIGHT_PAUSED_KEY = "jf-rankings-spotlight-paused";

/** Which board a podium opens: this month's League, the Hall of Strength, or last month's final standings. */
export type SpotlightBoard = "monthly" | "strength" | "champions";

/** A Hall of Strength podium's exact view (total, all-time), so a tap opens the board on it. */
export type StrengthView = { mode: BoardMode; division: Sex };

export type SpotlightPerson = { id: string; name: string; avatar_url: string | null; value: string; me: boolean };

export type SpotlightSlide = {
  /** "monthly", "strength:p4p:female", "strength:absolute:male", "champions". */
  key: string;
  board: SpotlightBoard;
  /** Strength podiums only. */
  view?: StrengthView;
  title: string;
  /** What the numbers are, in plain words. */
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

export const strengthSlideKey = (v: StrengthView) => `strength:${v.mode}:${v.division}`;

const SEX_WORD: Record<Sex, string> = { male: "Men", female: "Women" };

/** Pound for pound and heaviest each say exactly what's ranked, so the two never read as the same list. */
const MODE_WORDS: Record<BoardMode, { title: string; sub: string }> = {
  p4p: { title: "Pound for pound", sub: "Total ÷ bodyweight · all-time best" },
  absolute: { title: "Heaviest total", sub: "Squat + bench + deadlift · all-time best" },
};

function leaguePodium(rows: LeagueRow[]): SpotlightPerson[] {
  return rankedRows(rows).slice(0, 3).map((r) => ({
    id: r.client_id,
    name: podiumName(r.display_name),
    avatar_url: r.avatar_url,
    value: `${formatLeaguePoints(r.total_points)} pts`,
    me: r.is_me,
  }));
}

function strengthPodium(rows: StrengthRow[], view: StrengthView, unit: WeightUnit): SpotlightPerson[] {
  return pickBoard(rows, view.mode, "total", view.division, 3).top.map((r) => ({
    id: r.key,
    name: podiumName(r.display_name),
    avatar_url: r.avatar_url,
    value: view.mode === "p4p" ? `${formatMultiple(r.bw_multiple) ?? "—"} BW` : formatLoad(r.kg, unit),
    me: r.is_me,
  }));
}

/**
 * The podiums, in order: this month's League (live); the Hall of Strength's
 * top men and top women, pound for pound and then heaviest total (your own
 * division first, men first when we don't know it); then last month's
 * champions. A board nobody is ranked on yet is left out.
 */
export function spotlightSlides(input: {
  monthly: LeagueRow[];
  previous: LeagueRow[];
  strength: StrengthRow[];
  /** The viewer's division: theirs leads each pair. */
  division: Division;
  unit: WeightUnit;
  monthStart: string;
  previousMonthStart: string;
}): SpotlightSlide[] {
  const sexes: Sex[] = input.division === "female" ? ["female", "male"] : ["male", "female"];
  const strength = (["p4p", "absolute"] as const).flatMap((mode) =>
    sexes.map((division): SpotlightSlide => {
      const view = { mode, division };
      return {
        key: strengthSlideKey(view),
        board: "strength",
        view,
        title: `${SEX_WORD[division]} · ${MODE_WORDS[mode].title}`,
        sub: MODE_WORDS[mode].sub,
        people: strengthPodium(input.strength, view, input.unit),
      };
    }),
  );
  const slides: SpotlightSlide[] = [
    { key: "monthly", board: "monthly", title: `${monthName(input.monthStart)} League`, sub: "Live · points this month", people: leaguePodium(input.monthly) },
    ...strength,
    { key: "champions", board: "champions", title: `${monthName(input.previousMonthStart)} Champions`, sub: "Final League standings", people: leaguePodium(input.previous) },
  ];
  return slides.filter((s) => s.people.length > 0);
}
