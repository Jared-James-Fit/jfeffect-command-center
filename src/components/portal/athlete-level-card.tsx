import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, ChevronDown, ChevronRight, Scale } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AvatarPhoto } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { useBadgeCatalog, useMyAchievements, usePublicAchievements, type AchievementMetrics } from "@/lib/athlete-achievements";
import { AchievementCelebrations, MyAchievementsRow, PublicAchievements } from "@/components/portal/achievements-card";
import { LEAGUE_RULES, LEAGUE_RECORDS_NOTE, formatLeaguePoints } from "@/lib/league-points";
import { formatWeightLifted } from "@/lib/weight-lifted";
import { useWeightUnit } from "@/lib/use-weight-unit";
import { isFinalWeek, leagueToday } from "@/lib/league-boost";
import { BoostHero, MonthBreakdown, RowBoost, ThreatBanner } from "@/components/portal/league-boost";
import { CoachTag } from "@/components/portal/coach-tag";
import { CoachFocus, PointsBar, PointsLegend, VsCard } from "@/components/portal/league-insights";
import { inRecapWindow, monthName, previousLeagueMonth } from "@/lib/league-recap";
import { LeagueRecapButton } from "@/components/portal/league-recap";
import { LiveMark } from "@/components/live-indicator";
import { LEAGUE_ONE_LINER, TIEBREAK_NOTE, boostProgress, monthClockLabel, rankedRows, standingOf, standingText } from "@/lib/league-standing";
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

/** The scoreboard shows the Top 10 (and you, if you're below it), this month and last. */
const SHOWN = 10;
const MEDALS = ["🥇", "🥈", "🥉"];

/**
 * Crew → Rankings → Monthly: this month's League in one plain card. The
 * title and one line saying what it is, then you (rank, points, the one line
 * that says what's next, the boost; your breakdown one tap away), then the
 * Top 10. Colour only where it means something (green: boost unlocked; amber:
 * the final days). Last month's final standings, Milestones and the rules are
 * rows underneath, one tap away. One query (get_performance_league). Logging
 * Level points still accrue (DB triggers) and feed Milestones; the level
 * itself isn't shown to clients. New-milestone reveals pop on Home
 * (LevelCelebrations).
 */
export function AthleteLevelCard({ clientId, openPrevious = false }: {
  clientId: string;
  /** Open on last month's final standings (the Rankings spotlight's Champions podium). */
  openPrevious?: boolean;
}) {
  const { data: events = [] } = useXpEvents(clientId);
  const stats = statsFromEvents(events);
  const { data: catalog = [] } = useBadgeCatalog();
  const { data: earned = [] } = useMyAchievements(clientId);
  const { data: rows = [], isPending } = usePerformanceLeague("current");
  // The sheet holds only an athlete's details or last month's final standings.
  const [sheet, setSheet] = useState<null | { kind: "athlete"; id: string; fromPrevious?: boolean } | { kind: "previous" }>(() => (openPrevious ? { kind: "previous" } : null));

  const me = rows.find((r) => r.client_id === clientId) ?? rows.find((r) => r.is_me) ?? null;
  const ranked = rankedRows(rows);
  // The scoreboard is the Top 10 (and you, if you're below it): never the whole roster.
  const shown = ranked.filter((r) => Number(r.rank) <= SHOWN);
  const meBelow = me?.qualified && me.rank != null && me.rank > SHOWN ? me : null;
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
          <div className="px-4 pt-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-base font-semibold">{monthName(monthStart)} League</h3>
              {/* live, and how long is left */}
              <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-medium">
                {!me?.month_closed && <><LiveMark size={6}>Live</LiveMark><span className="text-muted-foreground">·</span></>}
                <span className={finalWeek ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}>{monthClockLabel(finalWeek)}</span>
              </span>
            </div>
            {/* what it is, in one line: nobody has to open the rules to get it */}
            <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{LEAGUE_ONE_LINER}</p>
          </div>

          {isPending ? (
            <div className="space-y-2 px-3 py-3">
              <div className="h-[60px] animate-pulse rounded-xl bg-muted/50" />
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-muted/40" />)}
            </div>
          ) : (
            <>
              <YouPanel me={me} rows={rows} finalWeek={finalWeek} />

              {/* Final week: the boost race, in one plain card under you */}
              {me?.qualified && finalWeek && (
                <div className="space-y-2 px-3 pt-2">
                  <BoostHero me={me} rows={rows} />
                  <ThreatBanner rows={rows} me={me} />
                </div>
              )}

              {ranked.length === 0 ? (
                <p className="mx-3 my-3 rounded-xl border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">
                  Nobody's ranked yet this month. Log your bodyweight and a workout to be first.
                </p>
              ) : (
                <ol className="mt-3 divide-y divide-border/60 border-t border-border/60" aria-label="Standings">
                  {[...shown, ...(meBelow ? [meBelow] : [])].map((r) => (
                    <li key={r.client_id}>
                      <BoardRow row={r} finalWeek={finalWeek} onOpen={() => openAthlete(r.client_id)} />
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </section>

        {/* last month's recap: above the tabs in recap week, here the rest of the month */}
        {!inRecapWindow() && <LeagueRecapButton />}

        {/* everything else, one tap away */}
        <section className="divide-y divide-border/60 overflow-hidden rounded-2xl border bg-card">
          <button
            type="button"
            onClick={() => setSheet({ kind: "previous" })}
            className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left text-[14px] font-medium active:bg-muted"
          >
            {prevName} final standings <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
          <MyAchievementsRow catalog={catalog} earned={earned} metrics={stats} variant="row" />
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

/** You, at the top of the board: rank, points, what's next, the boost; your points breakdown one tap away. */
function YouPanel({ me, rows, finalWeek }: { me: Row | null; rows: Row[]; finalWeek: boolean }) {
  const [open, setOpen] = useState(false);
  if (!me) return null;
  if (!me.qualified) {
    return (
      <div className="mx-3 mt-3 flex items-center gap-2.5 rounded-xl bg-muted/60 px-3 py-2.5">
        <Scale className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="text-[14px] font-semibold">Log your bodyweight to join</div>
          <div className="text-[12px] text-muted-foreground">Your latest entry is used. Points you've earned this month count once you're in.</div>
        </div>
      </div>
    );
  }
  const standing = standingOf(rows, me);
  return (
    <div data-league-you className="mx-3 mt-3 rounded-xl bg-muted/60">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-3 px-3 py-3 text-left">
        <span className="w-11 shrink-0 text-center text-[22px] font-semibold leading-none tabular-nums">#{me.rank}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold leading-tight tabular-nums">
            You · {formatLeaguePoints(me.total_points)} <span className="text-[12px] font-medium text-muted-foreground">pts</span>
          </span>
          <span className="block truncate text-[12px] leading-snug text-muted-foreground">{standingText(standing)}</span>
        </span>
        {/* the whole panel opens your breakdown; the chevron says so */}
        <ChevronDown className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {/* before the final week the boost is one line in here, not a box of its own */}
      {!finalWeek && <BoostProgressLine me={me} />}
      {open && (
        <div className="space-y-3 border-t border-border/60 px-3 pb-3 pt-1">
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
  const ready = me?.boost_status === "ready";
  return (
    <div data-boost-line className="border-t border-border/60 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="truncate font-medium">Final Week Boost</span>
        <span className={cn("shrink-0 tabular-nums", ready ? "font-medium text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
          {ready ? "Unlocked" : `${p.done} / ${p.target} workouts`}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-background">
        <div className={cn("h-full rounded-full", ready ? "bg-emerald-500" : "bg-foreground/70")} style={{ width: `${p.pct}%` }} />
      </div>
    </div>
  );
}

function BoardRow({ row: r, finalWeek, onOpen }: { row: Row; finalWeek: boolean; onOpen: () => void }) {
  const place = Number(r.rank);
  return (
    <button type="button" onClick={onOpen} className={cn("flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left active:bg-muted", r.is_me && "bg-muted/60")}>
      <span className="w-5 shrink-0 text-center text-[13px] font-medium tabular-nums text-muted-foreground">{MEDALS[place - 1] ?? place}</span>
      <RankAvatar row={r} size="h-8 w-8" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn("truncate text-[14px]", r.is_me ? "font-semibold" : "font-medium")}>{r.is_me ? "You" : r.display_name}</span>
          {r.is_coach && <CoachTag />}
        </span>
        {finalWeek && <RowBoost row={r} />}
      </span>
      <span className="shrink-0 text-[14px] font-semibold tabular-nums">{formatLeaguePoints(r.total_points)}</span>
    </button>
  );
}

/** The rules, folded: open when you want them. */
function HowPointsWork() {
  return (
    <details className="group px-4 py-1">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[14px] font-medium [&::-webkit-details-marker]:hidden">
        How points work
        <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" />
      </summary>
      <ul className="space-y-1.5 pb-1">
        {LEAGUE_RULES.map((rule) => (
          <li key={rule.key} className="flex items-baseline justify-between gap-3 text-[13px]">
            <span>{rule.label}{"note" in rule && rule.note ? <span className="text-muted-foreground"> · {rule.note}</span> : null}</span>
            <span className="shrink-0 font-semibold tabular-nums">+{rule.points}</span>
          </li>
        ))}
      </ul>
      {/* the tie rule gets its own line, so nobody has to dig for it */}
      <div data-tiebreak-rule className="mt-2.5 rounded-lg bg-muted/60 px-2.5 py-2 text-[12px]">
        <span className="font-semibold">Ties</span> · {TIEBREAK_NOTE}
      </div>
      <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
        Final Week Boost: finish 90%+ of your prescribed workouts and your workout points are matched to the month's highest.
      </p>
      <p className="mt-1.5 pb-3 text-[12px] leading-snug text-muted-foreground">
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
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums leading-tight">{value}</div>
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
              <div className="flex min-w-0 items-center gap-1.5"><span className="truncate text-lg font-semibold">{isMe ? "You" : p.display_name}</span>{p.is_coach && <CoachTag />}</div>
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
  const listed = [
    ...ranked.filter((r) => Number(r.rank) <= SHOWN),
    ...(me?.qualified && me.rank != null && me.rank > SHOWN ? [me] : []),
  ];
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
            <div className="flex items-center justify-between rounded-xl bg-muted/60 px-3 py-2.5 text-[14px] font-semibold">
              <span>You finished #{me.rank}</span>
              <span className="tabular-nums">{formatLeaguePoints(me.total_points)} pts</span>
            </div>
          )}
          <PointsLegend rows={ranked} />
          <ol className="divide-y overflow-hidden rounded-xl border">
            {listed.map((r) => (
              <li key={r.client_id}>
                <button type="button" onClick={() => onOpenAthlete(r.client_id)} className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm active:bg-muted", r.is_me && "bg-muted/60")}>
                  <span className="w-7 shrink-0 text-center font-medium text-muted-foreground">{MEDALS[Number(r.rank) - 1] ?? `#${r.rank}`}</span>
                  <RankAvatar row={r} size="h-9 w-9" />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5"><span className="truncate font-semibold">{r.is_me ? "You" : r.display_name}</span>{r.is_coach && <CoachTag />}</span>
                    <span className="block text-[11px] text-muted-foreground">{plural(r.workouts_completed, "workout")}</span>
                    <PointsBar row={r} max={top} className="mt-1.5" />
                  </span>
                  <span className="shrink-0 text-[13px] font-semibold tabular-nums">{formatLeaguePoints(r.total_points)} pts</span>
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
      <AvatarPhoto src={row.avatar_url} alt={row.display_name} />
      <AvatarFallback className="text-[11px] font-bold">{(row.display_name || "?").slice(0, 1).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

