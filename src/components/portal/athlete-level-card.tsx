import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, ChevronDown, ChevronRight, Flame, Scale } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useBadgeCatalog, useMyAchievements, usePublicAchievements, type AchievementMetrics } from "@/lib/athlete-achievements";
import { AchievementCelebrations, MyAchievementsRow, PublicAchievements } from "@/components/portal/achievements-card";
import { LEAGUE_RULES, LEAGUE_RECORDS_NOTE, formatLeaguePoints } from "@/lib/league-points";
import { RecordBadges } from "@/components/portal/record-badges";
import { formatWeightLifted } from "@/lib/weight-lifted";
import { useWeightUnit } from "@/lib/use-weight-unit";
import { isFinalWeek, leagueToday } from "@/lib/league-boost";
import { BoostHero, MonthBreakdown, RowBoost, ThreatBanner } from "@/components/portal/league-boost";
import { CoachTag } from "@/components/portal/coach-tag";
import { CoachFocus, PointsBar, PointsLegend, VsCard } from "@/components/portal/league-insights";
import { monthName, previousLeagueMonth } from "@/lib/league-recap";
import { TIEBREAK_NOTE, boostProgress, monthClockLabel, rankedRows, standingOf, standingText } from "@/lib/league-standing";
import { usePerformanceLeague, type PerformanceLeagueRow } from "@/lib/use-performance-league";

type XpEvent = { id: string; event_type: string; label: string | null; xp: number; occurred_at: string };
type Row = PerformanceLeagueRow;

function useXpEvents(clientId: string) {
  return useQuery({
    queryKey: ["athlete-xp", clientId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("athlete_xp_events")
        .select("id, event_type, label, xp, occurred_at")
        .eq("client_id", clientId)
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as XpEvent[];
    },
  });
}

/** The board shows the Top 10 (and you, if you're below it); "Show all" opens the rest in place. */
const SHOWN = 10;
const MEDALS = ["🥇", "🥈", "🥉"];

/**
 * Crew → Rankings → Monthly: this month's League in one card. You first
 * (rank, points, the one line that says what's next, your breakdown one tap
 * away), the Final Week Boost while it matters, then the board. Last month's
 * final standings and the rules sit folded underneath. One query
 * (get_performance_league), shared with Home's Rankings card. Logging Level
 * points still accrue (DB triggers) and feed Milestones; the level itself
 * isn't shown to clients. New-milestone reveals pop on Home (LevelCelebrations).
 */
export function AthleteLevelCard({ clientId }: { clientId: string }) {
  const { data: events = [] } = useXpEvents(clientId);
  const stats = statsFromEvents(events);
  const { data: catalog = [] } = useBadgeCatalog();
  const { data: earned = [] } = useMyAchievements(clientId);
  const { data: rows = [], isPending } = usePerformanceLeague("current");
  // The sheet holds only an athlete's details or last month's final standings.
  const [sheet, setSheet] = useState<null | { kind: "athlete"; id: string; fromPrevious?: boolean } | { kind: "previous" }>(null);
  const [showAll, setShowAll] = useState(false);

  const me = rows.find((r) => r.client_id === clientId) ?? rows.find((r) => r.is_me) ?? null;
  const ranked = rankedRows(rows);
  const shown = showAll ? ranked : ranked.filter((r) => Number(r.rank) <= SHOWN);
  const meBelow = !showAll && me?.qualified && me.rank != null && me.rank > SHOWN ? me : null;
  const finalWeek = me?.is_final_week ?? isFinalWeek();
  const monthStart = rows[0]?.month_start ?? `${leagueToday().slice(0, 7)}-01`;
  const prevName = monthName(previousLeagueMonth());
  const openAthlete = (id: string) => setSheet({ kind: "athlete", id });
  // from last month's standings, Back goes back to them
  const openFromPrevious = (id: string) => setSheet({ kind: "athlete", id, fromPrevious: true });

  return (
    <>
      <div className="space-y-3">
        <section data-standing="league" className="overflow-hidden rounded-2xl border bg-card">
          <div className="flex items-baseline justify-between gap-3 px-4 pt-3.5">
            <h3 className="text-lg font-black tracking-tight">{monthName(monthStart)} League</h3>
            <span className={cn("shrink-0 text-[11px] font-bold", finalWeek ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground")}>
              {monthClockLabel(finalWeek)}
            </span>
          </div>

          {isPending ? (
            <div className="space-y-2 px-3 pb-3 pt-3">
              <div className="h-[72px] animate-pulse rounded-xl bg-muted/50" />
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-9 animate-pulse rounded-lg bg-muted/40" />)}
            </div>
          ) : (
            <>
              <YouPanel me={me} rows={rows} />

              {/* Final week: the boost race is the story. Before it: one quiet progress line. */}
              {me?.qualified && finalWeek ? (
                <div className="space-y-2 px-3 pt-2.5">
                  <BoostHero me={me} rows={rows} />
                  <ThreatBanner rows={rows} me={me} />
                </div>
              ) : (
                <BoostProgressLine me={me} />
              )}

              {ranked.length === 0 ? (
                <p className="mx-3 mt-3 rounded-xl border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">
                  Nobody's ranked yet this month. Log your bodyweight and a workout to be first.
                </p>
              ) : (
                <ol className="mx-3 mt-3 divide-y divide-border/60 overflow-hidden rounded-xl bg-muted/25" aria-label="Standings">
                  {[...shown, ...(meBelow ? [meBelow] : [])].map((r) => (
                    <li key={r.client_id}>
                      <BoardRow row={r} finalWeek={finalWeek} onOpen={() => openAthlete(r.client_id)} />
                    </li>
                  ))}
                </ol>
              )}
              {ranked.length > SHOWN && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="mx-3 mt-2 flex min-h-10 w-[calc(100%-1.5rem)] items-center justify-center rounded-xl text-[13px] font-bold text-primary active:bg-muted"
                >
                  {showAll ? "Show top 10" : `Show all ${ranked.length}`}
                </button>
              )}
            </>
          )}

          {/* Milestones have no other home, so they stay on the board. */}
          <div className="px-3 pb-3 pt-2.5 [&>button]:mt-0 [&>button]:rounded-xl [&>button]:border-0 [&>button]:bg-muted/40 [&>button]:px-2.5 [&>button]:py-2">
            <MyAchievementsRow catalog={catalog} earned={earned} metrics={stats} />
          </div>
        </section>

        <section className="divide-y divide-border/70 overflow-hidden rounded-2xl border bg-card">
          <button
            type="button"
            onClick={() => setSheet({ kind: "previous" })}
            className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left text-[13px] font-bold active:bg-muted"
          >
            {prevName} final standings <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
          <HowPointsWork />
        </section>
      </div>

      <Sheet open={!!sheet} onOpenChange={(o) => { if (!o) setSheet(null); }}>
        <SheetContent side="bottom" hideCloseButton={sheet?.kind === "athlete"} className="max-h-[88dvh] overflow-y-auto overscroll-contain rounded-t-2xl px-5 pb-safe-bottom pt-5">
          {sheet?.kind === "athlete" ? (
            <CompareView
              key={sheet.id}
              clientId={sheet.id}
              myStats={stats}
              myBadgeCount={earned.length}
              me={me}
              them={rows.find((r) => r.client_id === sheet.id) ?? null}
              live={!me?.month_closed}
              onBack={() => setSheet(sheet.fromPrevious ? { kind: "previous" } : null)}
            />
          ) : sheet?.kind === "previous" ? (
            <FinalStandings onOpenAthlete={openFromPrevious} />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

/** You, at the top of the board: rank, points, what's next; your points breakdown one tap away. */
function YouPanel({ me, rows }: { me: Row | null; rows: Row[] }) {
  const [open, setOpen] = useState(false);
  if (!me) return null;
  if (!me.qualified) {
    return (
      <div className="mx-3 mt-2.5 flex items-center gap-2.5 rounded-xl bg-muted/50 px-3 py-2.5">
        <Scale className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="text-[13px] font-bold">Log your bodyweight to join</div>
          <div className="text-[11px] text-muted-foreground">Your latest entry is used. Points you've earned this month count once you're in.</div>
        </div>
      </div>
    );
  }
  const standing = standingOf(rows, me);
  return (
    <div data-league-you className="mx-3 mt-2.5 rounded-xl border border-primary/25 bg-primary/[0.06]">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
        <span className="grid h-12 min-w-12 shrink-0 place-items-center rounded-xl bg-primary px-1.5 text-primary-foreground">
          <span className="text-[19px] font-black leading-none tabular-nums">#{me.rank}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[20px] font-black leading-tight tabular-nums">
            {formatLeaguePoints(me.total_points)} <span className="text-[12px] font-bold text-muted-foreground">pts</span>
          </span>
          <span className="block text-[12px] font-semibold leading-snug text-muted-foreground">{standingText(standing)}</span>
        </span>
        <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-bold text-primary">
          <span className="max-[359px]:sr-only">Points</span> <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-primary/15 px-3 pb-3 pt-1">
          <MonthBreakdown me={me} />
          {!me.month_closed && <CoachFocus me={me} title="Your next moves" />}
        </div>
      )}
    </div>
  );
}

/** Before the final week: how close you are to the 90% that unlocks the boost. */
function BoostProgressLine({ me }: { me: Row | null }) {
  const p = me?.qualified ? boostProgress(me) : null;
  if (!p) return null;
  return (
    <div className="mx-3 mt-2 flex items-center gap-2.5 rounded-xl bg-orange-500/[0.07] px-3 py-2">
      <Flame className="h-4 w-4 shrink-0 text-orange-500" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2 text-[11px] font-bold">
          <span className="truncate">Final Week Boost</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{p.done} / {p.target} workouts</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-orange-500/15">
          <div className="h-full rounded-full bg-orange-500" style={{ width: `${p.pct}%` }} />
        </div>
      </div>
    </div>
  );
}

function BoardRow({ row: r, finalWeek, onOpen }: { row: Row; finalWeek: boolean; onOpen: () => void }) {
  const place = Number(r.rank);
  return (
    <button type="button" onClick={onOpen} className={cn("flex w-full items-center gap-2.5 px-2.5 py-2 text-left active:bg-muted", r.is_me && "bg-primary/10")}>
      <span className="w-6 shrink-0 text-center text-[12px] font-black tabular-nums text-muted-foreground">{MEDALS[place - 1] ?? place}</span>
      <RankAvatar row={r} size="h-7 w-7" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn("truncate text-[13px] font-semibold", r.is_me && "text-primary")}>{r.is_me ? "You" : r.display_name}</span>
          {r.is_coach && <CoachTag />}
        </span>
        <RecordBadges row={r} size="xs" best className="mt-0.5" />
        {finalWeek && <RowBoost row={r} />}
      </span>
      <span className="shrink-0 text-[13px] font-black tabular-nums">{formatLeaguePoints(r.total_points)}</span>
    </button>
  );
}

/** The rules, folded: open when you want them. */
function HowPointsWork() {
  return (
    <details className="group px-4 py-1">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[13px] font-bold [&::-webkit-details-marker]:hidden">
        How points work
        <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" />
      </summary>
      <ul className="space-y-1 pb-1">
        {LEAGUE_RULES.map((rule) => (
          <li key={rule.key} className="flex items-baseline justify-between gap-3 text-xs">
            <span>{rule.label}{"note" in rule && rule.note ? <span className="text-muted-foreground"> · {rule.note}</span> : null}</span>
            <span className="shrink-0 font-black text-primary">+{rule.points}</span>
          </li>
        ))}
      </ul>
      {/* the tie rule gets its own line, so nobody has to dig for it */}
      <div data-tiebreak-rule className="mt-2.5 rounded-lg bg-muted/50 px-2.5 py-2 text-xs">
        <span className="font-black">🤝 Ties</span> · {TIEBREAK_NOTE}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        🔥 Final Week Boost: finish 90%+ of your prescribed workouts and your workout points are matched to the month's highest.
      </p>
      <p className="mt-1.5 pb-3 text-[11px] leading-snug text-muted-foreground">
        {LEAGUE_RECORDS_NOTE} Resets on the 1st; log your bodyweight once to join.
      </p>
    </details>
  );
}

/** New-milestone reveals, for a page that doesn't show the standings themselves (Home). */
export function LevelCelebrations({ clientId }: { clientId: string }) {
  const { data: catalog = [] } = useBadgeCatalog();
  return <AchievementCelebrations clientId={clientId} catalog={catalog} />;
}

type BadgeStats = AchievementMetrics;

function statsFromEvents(events: XpEvent[]): BadgeStats {
  const done = events.filter((e) => e.event_type === "workout_completed");
  const first = done.length ? done[done.length - 1].occurred_at : null;
  const counts: Record<string, number> = {};
  const weeks = new Set<string>();
  for (const e of events) {
    counts[e.event_type] = (counts[e.event_type] ?? 0) + 1;
    const d = new Date(e.occurred_at); const day = (d.getUTCDay() + 6) % 7;
    weeks.add(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10));
  }
  return {
    events: counts,
    tracking_weeks: weeks.size,
    xp: events.reduce((s, e) => s + (e.xp || 0), 0),
    workouts_completed: done.length,
    workouts_fully_logged: events.filter((e) => e.event_type === "workout_fully_logged").length,
    days_since_first_workout: first ? (Date.now() - new Date(first).getTime()) / 86_400_000 : 0,
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type WeightLifted = { month_lb: number; lifetime_lb: number; month_sessions: number; lifetime_sessions: number };

function useWeightLifted(clientId: string | null | undefined) {
  return useQuery({
    queryKey: ["athlete-weight-lifted", clientId],
    enabled: !!clientId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<WeightLifted | null> => {
      const { data, error } = await (supabase as any).rpc("get_athlete_weight_lifted", { _client_id: clientId });
      if (error) throw error;
      const r = (data ?? [])[0];
      if (!r) return null;
      return {
        month_lb: Number(r.month_lb ?? 0),
        lifetime_lb: Number(r.lifetime_lb ?? 0),
        month_sessions: Number(r.month_sessions ?? 0),
        lifetime_sessions: Number(r.lifetime_sessions ?? 0),
      };
    },
  });
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border bg-card px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xl font-black tabular-nums leading-tight">{value}</div>
      {sub && <div className="truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/**
 * One athlete, tapped on the board: this month head to head with you (and
 * what would close the gap), their month and lifetime numbers, their badges.
 */
function CompareView({ clientId, myStats, myBadgeCount, me, them, live, onBack }: {
  clientId: string;
  myStats: BadgeStats;
  myBadgeCount: number;
  me: Row | null;
  them: Row | null;
  /** The month is still running, so coaching tips make sense. */
  live: boolean;
  onBack: () => void;
}) {
  const { data: p, isPending } = useQuery({
    queryKey: ["athlete-public-profile", clientId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_athlete_public_profile", { _client_id: clientId });
      if (error) throw error;
      return ((data ?? [])[0] ?? null) as any;
    },
  });
  // In coach "View as client" the session isn't the client, so match on id too.
  const povClientId = useClientImpersonation().client?.id ?? null;
  const isMe = !!p?.is_me || (!!povClientId && clientId === povClientId) || !!them?.is_me;
  const { unit } = useWeightUnit();
  const { data: theirWeight, isPending: weightPending } = useWeightLifted(clientId);
  const { data: publicBadges = [] } = usePublicAchievements(clientId);
  const month = format(new Date(), "MMMM");
  const lifetimeWorkouts = Number(p?.workouts_completed ?? 0);
  const monthWorkouts = Number(p?.month_workouts_completed ?? them?.workouts_completed ?? 0);
  const since = p?.first_workout_at ? format(new Date(p.first_workout_at), "MMM yyyy") : null;
  const weightValue = (lb?: number) => (theirWeight ? formatWeightLifted(lb ?? 0, unit) : weightPending ? "…" : "—");
  const weightSub = (n?: number) => (theirWeight ? plural(n ?? 0, "session") : undefined);
  const rankLine = them?.qualified && them.rank != null ? `#${them.rank} · ${formatLeaguePoints(them.total_points)} pts this month` : null;

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="flex min-h-10 items-center gap-1 text-xs font-semibold text-muted-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Rankings
      </button>
      {isPending ? <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div> : !p ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Athlete not available.</div>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <RankAvatar row={{ display_name: p.display_name, avatar_url: p.avatar_url }} size="h-14 w-14" />
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5"><span className="truncate text-lg font-black">{isMe ? "You" : p.display_name}</span>{p.is_coach && <CoachTag />}</div>
              <div className="mt-0.5 text-[12px] font-semibold text-muted-foreground">{rankLine ?? `${publicBadges.length} milestones`}</div>
            </div>
          </div>

          {!isMe && me?.qualified && them?.qualified && (
            <div className="space-y-2">
              <VsCard me={me} them={them} themName={p.display_name} />
              {live && <CoachFocus me={me} title={them.total_points > me.total_points ? "How to close the gap" : "How to stay ahead"} />}
            </div>
          )}
          {isMe && them && <MonthBreakdown me={them} />}

          <div className="grid grid-cols-2 gap-2">
            <StatTile label={`${month} workouts`} value={monthWorkouts.toLocaleString()} sub={!isMe ? `You: ${me?.workouts_completed ?? 0}` : undefined} />
            <StatTile label={`${month} lifted`} value={weightValue(theirWeight?.month_lb)} sub={weightSub(theirWeight?.month_sessions)} />
            <StatTile label="Lifetime workouts" value={lifetimeWorkouts.toLocaleString()} sub={since ? `Since ${since}` : !isMe ? `You: ${Number(myStats.workouts_completed ?? 0).toLocaleString()}` : undefined} />
            <StatTile label="Lifetime lifted" value={weightValue(theirWeight?.lifetime_lb)} sub={weightSub(theirWeight?.lifetime_sessions)} />
          </div>

          <PublicAchievements badges={publicBadges} name={isMe ? "You" : p.display_name} />
          {!isMe && <p className="text-center text-[11px] text-muted-foreground">You have {plural(myBadgeCount, "milestone")}.</p>}
        </>
      )}
    </div>
  );
}

/** Last month's final standings (Final Week Boost awards included), in the sheet. */
function FinalStandings({ onOpenAthlete }: { onOpenAthlete: (id: string) => void }) {
  const { data = [], isPending } = usePerformanceLeague("previous");
  const ranked = rankedRows(data);
  const top = Math.max(0, ...ranked.map((r) => r.total_points));
  const me = data.find((r) => r.is_me);
  const name = monthName(previousLeagueMonth());
  return (
    <div className="space-y-4">
      <SheetHeader className="text-left">
        <SheetTitle>{name} final standings</SheetTitle>
        <SheetDescription>Final results, Final Week Boost included. Tap anyone to see their month.</SheetDescription>
      </SheetHeader>
      {isPending ? <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div> : ranked.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nobody was ranked in {name}.</div>
      ) : (
        <>
          {me?.qualified && me.rank != null && (
            <div className="flex items-center justify-between rounded-xl bg-primary/[0.07] px-3 py-2 text-[13px] font-bold">
              <span>You finished #{me.rank}</span>
              <span className="tabular-nums text-primary">{formatLeaguePoints(me.total_points)} pts</span>
            </div>
          )}
          <PointsLegend rows={ranked} />
          <ol className="divide-y overflow-hidden rounded-xl border">
            {ranked.map((r) => (
              <li key={r.client_id}>
                <button type="button" onClick={() => onOpenAthlete(r.client_id)} className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm active:bg-muted", r.is_me && "bg-primary/5")}>
                  <span className="w-7 shrink-0 text-center font-black text-muted-foreground">{MEDALS[Number(r.rank) - 1] ?? `#${r.rank}`}</span>
                  <RankAvatar row={r} size="h-9 w-9" />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5"><span className="truncate font-bold">{r.is_me ? "You" : r.display_name}</span>{r.is_coach && <CoachTag />}</span>
                    <span className="block text-[10px] text-muted-foreground">{plural(r.workouts_completed, "workout")}</span>
                    <PointsBar row={r} max={top} className="mt-1.5" />
                  </span>
                  <span className="shrink-0 text-xs font-black text-primary">{formatLeaguePoints(r.total_points)} pts</span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function RankAvatar({ row, size }: { row: { display_name: string; avatar_url: string | null }; size: string }) {
  return (
    <Avatar className={cn(size, "shrink-0 border border-border")}>
      {row.avatar_url && <AvatarImage src={row.avatar_url} alt={row.display_name} />}
      <AvatarFallback className="text-[11px] font-bold">{(row.display_name || "?").slice(0, 1).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

