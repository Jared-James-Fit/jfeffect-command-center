import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FULLY_LOGGED_WORKOUT_POINTS,
  boardMoves,
  chaseLine,
  moveMark,
  prLine,
  rankMove,
  spotlightReady,
  spotlightSeenKey,
  weekFacts,
  weekHeadline,
  weekRange,
  type LeagueWeek,
} from "@/lib/league-week";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

/**
 * Crew and Rankings, Nov 19 2026: Rankings became the third tab in Crew's bar
 * (Crew · Following · Rankings, the trophy gone), the Rankings page leads with
 * the board switch and you (rank, how it moved since Monday, points this week),
 * and a Monday card in the feed says how last week went, all from the League's
 * own scoring kept once a week (league_week_snapshots).
 */

const row = (id: string, rank: number | null, pts: number, extra: Record<string, unknown> = {}) => ({
  client_id: id,
  display_name: id.toUpperCase(),
  rank,
  total_points: pts,
  qualified: rank != null,
  is_me: false,
  ...extra,
});

const me = (over: Partial<LeagueWeek["me"]> = {}): LeagueWeek["me"] => ({
  client_id: "c7",
  qualified: true,
  rank: 7,
  prev_rank: 12,
  total_points: 140,
  week_points: 60,
  workouts: 4,
  fully_logged: 3,
  bodyweight_logs: 5,
  posts: 0,
  prs: [],
  ...over,
});

describe("movement on the board", () => {
  it("is up / down by spots, nothing when there's no rank to compare with", () => {
    expect(rankMove(7, 12)).toEqual({ dir: "up", spots: 5 });
    expect(rankMove(4, 2)).toEqual({ dir: "down", spots: 2 });
    expect(rankMove(3, 3)).toEqual({ dir: "same", spots: 0 });
    expect(rankMove(3, null)).toBeNull();
    expect(rankMove(null, 3)).toBeNull();
    expect(moveMark(rankMove(7, 12))).toBe("▲5");
    expect(moveMark(rankMove(4, 2))).toBe("▼2");
    expect(moveMark(rankMove(3, 3))).toBeNull();
  });

  it("reads the live board against Monday's: someone new this week has no made-up ▲, and the week's points never go negative", () => {
    const rows = [row("a", 1, 285), row("b", 2, 260), row("n", 3, 50), row("u", null, 0)];
    const baseline = [
      { client_id: "a", rank: 3, total_points: 220, qualified: true },
      { client_id: "b", rank: 1, total_points: 240, qualified: true },
      { client_id: "n", rank: null, total_points: 20, qualified: false },
    ];
    const m = boardMoves(rows as never, baseline);
    expect(m.get("a")).toEqual({ move: { dir: "up", spots: 2 }, weekPoints: 65 });
    expect(m.get("b")).toEqual({ move: { dir: "down", spots: 1 }, weekPoints: 20 });
    expect(m.get("n")).toEqual({ move: null, weekPoints: 30 });
    expect(m.get("u")).toEqual({ move: null, weekPoints: null });
    // the week a month starts there's no baseline at all: nothing moves
    expect(boardMoves(rows as never, []).size).toBe(0);
  });
});

describe("the Monday card", () => {
  it("is ready from 6 AM Monday on the person's own clock, never before", () => {
    // the week of Nov 9 – 15 ends Sunday the 15th
    expect(spotlightReady("2026-11-15", new Date(2026, 10, 16, 5, 59))).toBe(false);
    expect(spotlightReady("2026-11-15", new Date(2026, 10, 16, 6, 0))).toBe(true);
    expect(spotlightReady("2026-11-15", new Date(2026, 10, 19, 14, 0))).toBe(true);
    expect(spotlightReady("2026-11-15", new Date(2026, 10, 15, 23, 0))).toBe(false);
    // a month's last Sunday into the next month's Monday
    expect(spotlightReady("2026-11-29", new Date(2026, 10, 30, 6, 30))).toBe(true);
  });

  it("is seen once per week, by its Monday, server-side", () => {
    expect(spotlightSeenKey("2026-11-09")).toBe("league_week:2026-11-09");
    const queries = read("src/lib/league-week.queries.ts");
    expect(queries).toContain("hasSeenFeature(user!.id, spotlightSeenKey(weekStart!))");
    const card = read("src/components/community/league-week-card.tsx");
    expect(card).toContain("void markFeatureSeen(uid, spotlightSeenKey(weekStart));");
    // a coach viewing as a client never reads or records it
    expect(queries).toContain("enabled: !!user?.id && !!weekStart && !preview,");
    expect(card).toContain("if (done.current || preview || !uid) return;");
    expect(card).not.toContain("localStorage");
  });

  it("says the week plainly: dates, the move as a chip (no title repeating it), only facts that happened", () => {
    expect(weekRange("2026-11-09", "2026-11-15")).toBe("Nov 9 – 15");
    expect(weekRange("2026-11-30", "2026-12-06")).toBe("Nov 30 – Dec 6");
    expect(weekHeadline(me())).toEqual({ title: "Up 5 to #7", emoji: "📈" });
    expect(weekHeadline(me({ rank: 1, prev_rank: 3 }))).toEqual({ title: "Up to #1", emoji: "🏆" });
    expect(weekHeadline(me({ rank: 1, prev_rank: 1 }))).toEqual({ title: "Held #1", emoji: "🏆" });
    expect(weekHeadline(me({ rank: 5, prev_rank: 3 }))).toEqual({ title: "Down 2 to #5", emoji: null });
    expect(weekHeadline(me({ prev_rank: null }))).toEqual({ title: "#7 on the board", emoji: null });
    expect(weekHeadline(me({ qualified: false, rank: null }))).toEqual({ title: "Not on the board yet", emoji: null });
    expect(weekFacts(me())).toEqual(["4 workouts", "3 fully logged", "bodyweight 5 days"]);
    expect(weekFacts(me({ workouts: 1, fully_logged: 1, bodyweight_logs: 1, posts: 2 }))).toEqual(["1 workout", "all fully logged", "bodyweight 1 day", "2 Crew posts"]);
    expect(weekFacts(me({ workouts: 0, fully_logged: 0, bodyweight_logs: 0 }))).toEqual([]);
    expect(prLine([])).toBeNull();
    expect(prLine([{ exercise: "Competition Squat", reps: 3, load_kg: 170 }])).toBe("All-time PR on Competition Squat");
    expect(prLine([{ exercise: "A", reps: 1, load_kg: 1 }, { exercise: "B", reps: 1, load_kg: 1 }])).toBe("All-time PRs on A and B");
    expect(prLine(["A", "B", "C", "D"].map((e) => ({ exercise: e, reps: 1, load_kg: 1 })))).toBe("All-time PRs on A, B and 2 more");
  });

  it("gives one honest reason to come back, from the live board, never asking for more training than the plan", () => {
    expect(FULLY_LOGGED_WORKOUT_POINTS).toBe(15);
    const board = [row("a", 1, 285), row("b", 2, 260), row("c", 3, 240), row("d", 4, 200), row("e", 5, 199)];
    const at = (id: string) => ({ ...board.find((r) => r.client_id === id)!, is_me: true });
    const rowsAs = (id: string) => board.map((r) => (r.client_id === id ? at(id) : r));
    expect(chaseLine(rowsAs("a"), at("a"))).toBe("You lead B by 25 pts. Log your planned workouts fully to hold #1.");
    // within one fully logged workout
    const close = [row("a", 1, 285), { ...row("b", 2, 275), is_me: true }];
    expect(chaseLine(close, close[1])).toBe("10 pts to catch A for #1. One fully logged workout closes it.");
    // within two
    expect(chaseLine(rowsAs("c"), at("c"))).toBe("20 pts to catch B for #2. Two fully logged workouts close it.");
    // further off: just the gap, never "do more workouts"
    expect(chaseLine(rowsAs("d"), at("d"))).toBe("40 pts to catch C for #3.");
    expect(chaseLine(rowsAs("e"), at("e"))).toBe("1 pt to catch D for #4. One fully logged workout closes it.");
    // a tie goes to whoever got there first (league_month_scores), so it's said as a tie
    const tie = [row("a", 1, 100), { ...row("b", 2, 100), is_me: true }];
    expect(chaseLine(tie, tie[1])).toBe("Tied with A for #1. Your next points pass them.");
    expect(chaseLine([{ ...row("a", 1, 50), is_me: true }], { ...row("a", 1, 50), is_me: true })).toBe("You're the only one on the board. Every fully logged workout counts.");
    const unranked = { ...row("z", null, 0), is_me: true };
    expect(chaseLine([...board, unranked], unranked)).toMatch(/^Log your bodyweight to get on the board/);
    // the final week: the Boost comes first while it's still being chased
    const fw = { ...row("c", 3, 240), is_me: true, is_final_week: true, month_closed: false, boost_status: "chasing", needed_workouts: 2 };
    expect(chaseLine([...board.filter((r) => r.client_id !== "c"), fw] as never, fw as never)).toBe("Final week: 2 workouts to unlock your Boost.");
    expect(chaseLine(board, null)).toBeNull();
    // the plan is the limit: the words never invite extra sessions
    const lib = read("src/lib/league-week.ts");
    expect(lib).not.toMatch(/extra workout|more workouts|train more/i);
  });
});

describe("the week's standings are the League's own, kept once a week", () => {
  const sql = read("supabase/migrations/20270417090000_league_weekly_spotlight.sql");
  it("snapshots Monday 00:00 in the league's clock through league_month_scores itself (scoring unchanged)", () => {
    expect(sql).toContain("_at := public.local_to_instant(_week_start::timestamp, public.league_tz());");
    expect(sql).toContain("FROM public.league_month_scores(_week_start, _at) s");
    expect(sql).not.toMatch(/AT TIME ZONE 'America\/Winnipeg'/i);
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.league_month_scores/);
    // once per Monday, one writer at a time, never a future Monday
    expect(sql).toContain("PRIMARY KEY (week_start, client_id)");
    expect(sql).toContain("PERFORM pg_advisory_xact_lock(hashtext('league_week_snapshot:' || _week_start::text));");
    expect(sql).toContain("IF _at > now() THEN");
    expect(sql).toContain("PERFORM cron.schedule('league-week-snapshots', '7 * * * *', $cmd$SELECT public.league_week_snapshots_ensure()$cmd$);");
  });
  it("is server only, and shows nothing the board doesn't (its top 50 and you)", () => {
    expect(sql).toContain("ALTER TABLE public.league_week_snapshots ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain("REVOKE ALL ON public.league_week_snapshots FROM anon, authenticated;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.league_week_snapshot_take(date) FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.get_league_week_spotlight(uuid) FROM PUBLIC, anon;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.get_league_week_spotlight(uuid) TO authenticated;");
    expect(sql).toContain("WHERE n.qualified AND n.rank <= 50");
    // "View as client" goes through the same rule as the board (admins and the client's coach only)
    expect(sql).toContain("v uuid := public.portal_viewer_uid(_as_user);");
  });
  it("stays quiet in a month's first week (the monthly recap is that week's moment) and compares only within one month", () => {
    expect(sql).toContain("IF extract(day FROM w) <= 7 THEN RETURN NULL; END IF;");
    expect(sql).toContain("AND w > m;");
    expect(sql).toContain("WHERE s.week_start = prev AND s.client_id = me.client_id AND s.month_start = m;");
    // PRs are all-time records of 10 reps or fewer from finished workouts, in the week
    expect(sql).toContain("WHERE x.completed AND x.is_atpr AND x.reps BETWEEN 1 AND 10");
  });
});

describe("where it shows", () => {
  const screen = read("src/components/community/community-screen.tsx");
  it("is a screen of the feed right after the first post, decided once a visit while you're on the first screen", () => {
    expect(screen).toContain('if (weekCard) out.push({ key: "league-week", node: <LeagueWeekScreen week={week} onRankings={openRankings} /> });');
    expect(screen).toContain("const weekCard = i === 0 && !following && weekSlot === \"show\" && week;");
    expect(screen).toContain('setWeekSlot(unseen && window.scrollY < window.innerHeight * 0.5 ? "show" : "skip");');
    expect(screen).toContain('useEffect(() => onNewVisit(() => setWeekSlot("wait")), []);');
    // never on the coach's own page; it takes the people-to-follow spot that visit
    expect(screen).toContain("const weekOn = ownBar && !coach;");
    expect(screen).toContain("if (!previewOnly && !following && !coach && i === 0 && !weekCard && !photoCard)");
  });
  it("is one tap away all week on Rankings (Last week), and its button opens Rankings", () => {
    const card = read("src/components/portal/athlete-level-card.tsx");
    expect(card).toContain("data-league-last-week");
    expect(card).toContain('<LeagueWeekSheet week={lastWeek ?? null} open={weekOpen} onOpenChange={setWeekOpen} />');
    const week = read("src/components/community/league-week-card.tsx");
    expect(week).toContain("See the rankings");
    // no push, no popup: the feed card and the row are the only ways it shows
    expect(week).not.toMatch(/sendPush|notify|Dialog/);
  });
});

describe("Crew's bar and the Rankings page", () => {
  it("has Crew · Following · Rankings in the middle and no trophy; the + stays", () => {
    const screen = read("src/components/community/community-screen.tsx");
    expect(screen).not.toContain("data-crew-rankings");
    expect(screen).toContain("<BarButton label=\"Create a post\" onClick={begin} data-crew-create>");
    const bar = read("src/components/community/crew-header.tsx");
    // centred whenever it fits, never under the buttons (a grid, not an absolute strip)
    expect(bar).toContain("grid-cols-[minmax(max-content,1fr)_minmax(0,auto)_minmax(max-content,1fr)]");
    expect(bar).not.toContain("absolute inset-x-[92px]");
  });
  it("leads with the switch, then you (rank, ▲ since Monday, + this week), the boards named for what they are", () => {
    const hub = read("src/components/community/league-hub.tsx");
    expect(hub.indexOf('aria-label="Leaderboard"')).toBeLessThan(hub.indexOf("data-rankings-board={board}"));
    const card = read("src/components/portal/athlete-level-card.tsx");
    expect(card).toContain("data-you-move");
    expect(card).toContain("data-you-week-points");
    expect(card).toContain("data-row-move");
    const strength = read("src/components/portal/strength-board.tsx");
    expect(strength).toContain("export function strengthExplainer(");
    // the board's numbers aren't the brand red (red is a screen's one main action)
    const slide = strength.slice(strength.indexOf("export function StrengthBoardSlide"), strength.indexOf("function KingTile"));
    expect(slide).not.toContain("text-primary");
    expect(slide).not.toContain("uppercase");
  });
});
