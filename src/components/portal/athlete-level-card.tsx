import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Info, Trophy, Medal, Zap, ChevronRight, Scale, Crown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useClientImpersonation, usePortalUserId } from "@/lib/client-impersonation";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ATHLETE_LEVELS, XP_RULES, levelForXp } from "@/lib/athlete-level";
import { cn } from "@/lib/utils";
import { useBadgeCatalog, useMyAchievements, usePublicAchievements, type AchievementMetrics } from "@/lib/athlete-achievements";
import { AchievementCelebrations, MyAchievementsRow, PublicAchievements } from "@/components/portal/achievements-card";
import { ArrowLeft } from "lucide-react";
import { LEAGUE_RULES, LEAGUE_RECORDS_NOTE, formatLeaguePoints, leaguePointsFromEncoded } from "@/lib/league-points";
import { RecordBadges } from "@/components/portal/record-badges";
import { LeagueRecapButton, LeagueRecapHomeTile } from "@/components/portal/league-recap";
import { formatWeightLifted, type WeightUnit } from "@/lib/weight-lifted";
import { useWeightUnit } from "@/lib/use-weight-unit";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { isFinalWeek, leagueToday, type LeagueRow as BoostLeagueRow } from "@/lib/league-boost";
import { BoostHero, BoostTeaser, MonthBreakdown, RowBoost, ThreatBanner } from "@/components/portal/league-boost";
import { CoachTag } from "@/components/portal/coach-tag";
import { CoachFocus, PointsBar, PointsLegend, VsCard } from "@/components/portal/league-insights";
import { HallOfStrength } from "@/components/portal/strength-board";

type XpEvent = { id: string; event_type: string; label: string | null; xp: number; occurred_at: string };
type RankRow = { client_id: string; display_name: string; avatar_url: string | null; xp: number; rank: number; is_me: boolean; is_coach?: boolean };
type LeagueRow = { client_id:string; display_name:string; avatar_url:string|null; monthly_xp:number; rank:number|null; is_me:boolean; qualified:boolean; is_coach?:boolean };
const leagueScore=(r?:LeagueRow|null)=>leaguePointsFromEncoded(r?.monthly_xp);

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

/**
 * The athlete's standings (the League tab): this month's League with its whole
 * Top 10, their Logging Level, plus any extra boards passed in (the Hall of
 * Strength), a card each. New-milestone reveals pop on Home (LevelCelebrations).
 */
export function AthleteLevelCard({ clientId, defaultView = null, boards = [] }: {
  clientId: string;
  defaultView?: null | "rankings";
  boards?: { key: string; node: ReactNode }[];
}) {
  const { data: events = [], isPending } = useXpEvents(clientId);
  const [open, setOpen] = useState<null | "levels" | "rankings" | "powerlifting">(defaultView);
  const [selectedLeagueAthlete, setSelectedLeagueAthlete] = useState<string | null>(null);
  const total = events.reduce((s, e) => s + (e.xp || 0), 0);
  const lvl = levelForXp(total);
  const stats = statsFromEvents(events);
  const { data: catalog = [] } = useBadgeCatalog();
  const { data: earned = [] } = useMyAchievements(clientId);
  const viewerId = usePortalUserId() ?? null;
  const { data: leagueRows = [], isPending: leaguePending } = useQuery({
    queryKey:["athlete-rankings-monthly-raw", viewerId],
    staleTime:60_000,
    queryFn:async()=>{ const {data,error}=await (supabase as any).rpc("get_monthly_athlete_rankings",{_limit:50, ...(viewerId ? { _as_user: viewerId } : {})}); if(error) throw error; return (data??[]) as LeagueRow[]; }
  });
  const leagueMe=leagueRows.find(r=>r.client_id===clientId) ?? leagueRows.find(r=>r.is_me);
  const leagueTop=leagueRows.filter(r=>r.qualified && r.rank!=null).sort((a,b)=>Number(a.rank)-Number(b.rank)).slice(0,3);
  useEffect(() => { const h=()=>setOpen("levels"); window.addEventListener("jf-open-athlete-levels",h); return () => window.removeEventListener("jf-open-athlete-levels",h); }, []);

  const openRankings = (athlete: string | null = null) => { setSelectedLeagueAthlete(athlete); setOpen("rankings"); };
  // The card shows the Top 5 (and you, if you're outside it); Full standings has everyone.
  const top5 = leagueRows.filter(r=>r.qualified && r.rank!=null && Number(r.rank)<=5).sort((a,b)=>Number(a.rank)-Number(b.rank));
  const outside = !!leagueMe?.qualified && Number(leagueMe.rank) > 5;
  const rankedCount = leagueRows.filter(r=>r.qualified && r.rank!=null).length;

  // The month's league: where you stand, the podium, the Top 5, last month's recap, full standings.
  const leagueCard = (
    <div className="flex h-full flex-col">
      <button type="button" onClick={() => openRankings()} className="flex w-full items-start gap-3 px-4 pt-3 text-left active:opacity-70">
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{format(new Date(),"MMMM")} Performance League</span>
          <span className="mt-0.5 flex items-center gap-2 text-lg font-bold tracking-tight">Top 5 <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-600"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>Live</span></span>
          {isFinalWeek() && <span className="mt-1 inline-flex w-fit items-center rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">🔥 Final week · Boost live</span>}
        </span>
        {!leaguePending && leagueMe?.qualified && (
          <span className="shrink-0 text-right">
            <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Your rank</span>
            <span className="block text-lg font-bold leading-tight text-primary">#{leagueMe.rank}</span>
            <span className="block text-[11px] font-bold text-muted-foreground">{formatLeaguePoints(leagueScore(leagueMe))} pts</span>
          </span>
        )}
      </button>
      {!leaguePending && !leagueMe?.qualified && (
        <button type="button" onClick={() => openRankings()} className="mx-4 mt-2 flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2 text-left">
          <Scale className="h-4 w-4 text-muted-foreground"/>
          <span className="text-[11px] font-medium">Log bodyweight to enter the league</span>
        </button>
      )}
      {leagueTop.length > 0 && (
        <div className="mt-2.5 grid grid-cols-3 gap-1.5 px-3">
          {leagueTop.map((r) => {
            const place=Number(r.rank);
            const medal=place===1?"🥇":place===2?"🥈":"🥉";
            return (
              <button type="button" key={r.client_id} onClick={() => openRankings(r.client_id)} className="min-w-0 rounded-xl bg-muted/40 px-1.5 py-2 text-center transition-colors active:bg-muted">
                <div className="text-base leading-none">{medal}</div>
                <div className="mt-1 truncate text-xs font-semibold">{r.display_name}</div>
                {r.is_coach && <div className="mt-0.5 flex justify-center"><CoachTag /></div>}
                <div className="mt-0.5 text-[11px] font-bold text-primary">{formatLeaguePoints(leagueScore(r))} pts</div>
              </button>
            );
          })}
        </div>
      )}
      {/* 4th and 5th, and you if you're outside the Top 5 */}
      {(top5.length > 3 || outside) && (
        <ol className="mx-3 mt-2 divide-y divide-border/60 overflow-hidden rounded-xl bg-muted/25">
          {[...top5.slice(3), ...(outside && leagueMe ? [leagueMe] : [])].map((r) => (
            <li key={r.client_id}>
              <button type="button" onClick={() => openRankings(r.client_id)} className={cn("flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] active:bg-muted", r.is_me && "bg-primary/10")}>
                <span className="w-6 shrink-0 text-center text-[12px] font-black tabular-nums text-muted-foreground">{r.rank}</span>
                <span className="min-w-0 flex-1 truncate font-semibold">{r.is_me ? "You" : r.display_name}</span>
                {r.is_coach && <CoachTag />}
                <span className="shrink-0 text-[12px] font-bold tabular-nums text-primary">{formatLeaguePoints(leagueScore(r))} pts</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="mt-auto space-y-2 px-3 pb-3 pt-2.5">
        <button type="button" onClick={() => openRankings()} className="flex min-h-11 w-full items-center justify-center gap-1 rounded-xl border bg-background text-sm font-bold text-primary active:bg-muted">
          Full standings{rankedCount > 5 ? ` · all ${rankedCount}` : ""} <ChevronRight className="h-4 w-4" />
        </button>
        <LeagueRecapHomeTile variant="mini" />
      </div>
    </div>
  );

  // Logging Level: the level, the bar to the next one, milestones, competition records.
  const levelCard = (
    <div className="flex h-full flex-col px-4 pt-3">
      <button type="button" onClick={() => setOpen("levels")} className="w-full text-left active:opacity-70">
        <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Logging Level</span>
        <span className="mt-0.5 flex items-baseline justify-between gap-3">
          <span className="text-lg font-bold uppercase tracking-tight">{isPending ? "—" : lvl.current.name}</span>
          <span className="truncate text-[11px] text-muted-foreground">{lvl.next ? Number(lvl.remaining ?? 0).toLocaleString()+" pts to "+lvl.next.name : "Top level"}</span>
        </span>
        <Progress value={Number(lvl.pct ?? 0)} className="mt-2 h-1.5" />
      </button>
      {/* what just earned points: the level is earned, and this is how */}
      {events.length > 0 && (
        <ul className="mt-2.5 space-y-1">
          {events.slice(0, 2).map((e) => (
            <li key={e.id} className="flex min-w-0 items-center gap-2 text-[12px]">
              <span className="w-10 shrink-0 font-black tabular-nums text-primary">+{e.xp}</span>
              <span className="min-w-0 flex-1 truncate">{e.label ?? e.event_type.replace(/_/g, " ")}</span>
              <span className="shrink-0 text-muted-foreground">{whenLabel(e.occurred_at)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto grid grid-cols-2 gap-2 pb-3 pt-3">
        <div className="min-w-0 [&>button]:mt-0 [&>button]:h-full [&>button]:rounded-xl [&>button]:border-0 [&>button]:bg-muted/40 [&>button]:px-2.5 [&>button]:py-2"><MyAchievementsRow catalog={catalog} earned={earned} metrics={stats} /></div>
        <button type="button" onClick={() => setOpen("powerlifting")} className="flex min-w-0 items-center gap-2 rounded-xl bg-muted/40 px-2.5 py-2 text-left transition-colors active:bg-muted"><Medal className="h-4 w-4 shrink-0 text-primary"/><span className="truncate text-xs font-semibold">Meet records</span><ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground"/></button>
      </div>
    </div>
  );

  // League, then the boards (Hall of Strength), then the Logging Level.
  const cards = [{ key: "league", node: leagueCard }, ...boards, { key: "level", node: levelCard }];
  return (
    <>
      <div className="space-y-3">
        {cards.map((c) => (
          <section key={c.key} data-standing={c.key} className="overflow-hidden rounded-2xl border bg-card">
            {c.node}
          </section>
        ))}
      </div>

      <Sheet open={open === "levels" || open === "rankings"} onOpenChange={(o) => { if (!o) { setOpen(null); setSelectedLeagueAthlete(null); } }}>
        <SheetContent side="bottom" hideCloseButton={open === "rankings" && !!selectedLeagueAthlete} className="max-h-[88dvh] overflow-y-auto overscroll-contain rounded-t-2xl px-5 pb-safe-bottom pt-5">
          {open === "levels" ? <LevelsView total={total} events={events} />
            : open === "rankings" ? <RankingsView myStats={stats} myBadgeCount={earned.length} selected={selectedLeagueAthlete} onSelectedChange={setSelectedLeagueAthlete} />
            : null}
        </SheetContent>
      </Sheet>

      <Sheet open={open === "powerlifting"} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto overscroll-contain rounded-t-2xl px-5 pb-safe-bottom pt-5">
          <div className="min-h-[320px]">
            <HallOfStrength initialSource="meets" />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** "today" / "yesterday" / "Tue" / "Sep 28". */
function whenLabel(iso: string): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(d)) / 86_400_000);
  if (diff <= 0) return "today";
  if (diff === 1) return "yesterday";
  return diff < 7 ? format(d, "EEE") : format(d, "MMM d");
}

/** New-milestone reveals, for a page that doesn't show the standings themselves (Home). */
export function LevelCelebrations({ clientId }: { clientId: string }) {
  const { data: catalog = [] } = useBadgeCatalog();
  return <AchievementCelebrations clientId={clientId} catalog={catalog} />;
}

function LevelsView({ total, events }: { total: number; events: XpEvent[] }) {
  const lvl = levelForXp(total);
  return (
    <div className="space-y-5">
      <SheetHeader className="text-left">
        <SheetTitle>Logging Levels</SheetTitle>
        <SheetDescription>Your Logging Level reflects how consistently and completely you track your journey. Milestones are managed separately.</SheetDescription>
      </SheetHeader>
      <div className="grid grid-cols-4 gap-1.5 text-center">
        {["Train", "Log", "Earn points", "Level up"].map((t, i) => (
          <div key={t} className="rounded-xl border bg-muted/30 px-1 py-2">
            <div className="text-[10px] font-black text-primary">{i + 1}</div>
            <div className="text-[11px] font-bold leading-tight">{t}</div>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
        <div className="flex items-baseline justify-between"><span className="text-sm font-black uppercase">{lvl.current.name}</span><span className="text-xs text-muted-foreground">{Number(lvl.xp ?? 0).toLocaleString()} pts</span></div>
        <Progress value={lvl.pct} className="mt-2 h-2" />
        <div className="mt-1 text-[11px] text-muted-foreground">{lvl.next ? `${Number(lvl.remaining ?? 0).toLocaleString()} points to ${lvl.next.name}` : "Top level reached."}</div>
      </div>
      <ul className="space-y-1.5">
        {[...ATHLETE_LEVELS].reverse().map((l) => {
          const here = l.index === lvl.current.index;
          const reached = total >= l.min;
          return (
            <li key={l.name} className={cn("flex items-center justify-between rounded-lg border px-3 py-2 text-sm",
              here ? "border-primary bg-primary/10" : "border-border", !reached && "opacity-60")}>
              <div className="flex items-center gap-2">
                <span className="font-bold uppercase">{l.name}</span>
                {here && <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">YOU'RE HERE</span>}
              </div>
              <span className="text-xs text-muted-foreground">{Number(l.min ?? 0).toLocaleString()} pts</span>
            </li>
          );
        })}
      </ul>
      <div>
        <div className="mb-2 text-sm font-semibold">How to earn points</div>
        <ul className="space-y-1.5 text-sm">
          {XP_RULES.map((r) => (
            <li key={r.label} className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">{r.label}{r.cap && <span className="ml-1 text-[10px]">({r.cap})</span>}</span>
              <span className="shrink-0 font-bold text-primary">+{r.xp}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-muted-foreground">Editing a record never earns extra points. Monthly Performance League and the Hall of Strength are scored separately.</p>
      </div>
      <div>
        <div className="mb-2 text-sm font-semibold">Points history</div>
        {events.length === 0 ? (
          <div className="text-sm text-muted-foreground">Finish a workout or log something to earn your first points.</div>
        ) : (
          <ul className="divide-y text-sm">
            {events.slice(0, 25).map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5 text-primary" />
                  <span>{e.label ?? e.event_type}</span>
                </div>
                <div className="text-right">
                  <div className="font-bold">+{e.xp}</div>
                  <div className="text-[10px] text-muted-foreground">{format(new Date(e.occurred_at), "MMM d, yyyy")}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
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

type LeagueStat = { workouts_completed: number; rank: number; qualified: boolean; xp: number };

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

function CompareView({ clientId, myClientId, myStats, myBadgeCount, theirLeague, myLeague, theirRow, myRow, live, onBack }: {
  clientId: string;
  myClientId?: string | null;
  myStats: BadgeStats;
  myBadgeCount: number;
  theirLeague?: LeagueStat;
  myLeague?: LeagueStat;
  /** Full league rows for the month being viewed (points by source). */
  theirRow?: BoostLeagueRow;
  myRow?: BoostLeagueRow;
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
  const isMe = !!p?.is_me || (!!povClientId && clientId === povClientId);
  const theirXp = Number(p?.xp ?? 0);
  const { unit, setUnit } = useWeightUnit();
  const { data: theirWeight, isPending: weightPending } = useWeightLifted(clientId);
  const { data: myWeight } = useWeightLifted(!isMe ? myClientId : null);
  const { data: publicBadges = [] } = usePublicAchievements(clientId);
  const monthName = format(new Date(), "MMMM");
  const lifetimeWorkouts = Number(p?.workouts_completed ?? 0);
  const monthWorkouts = Number(p?.month_workouts_completed ?? theirLeague?.workouts_completed ?? 0);
  const fullyLogged = Number(p?.workouts_fully_logged ?? 0);
  const loggedPct = lifetimeWorkouts > 0 ? Math.round((Math.min(fullyLogged, lifetimeWorkouts) / lifetimeWorkouts) * 100) : 0;
  const since = p?.first_workout_at ? format(new Date(p.first_workout_at), "MMM yyyy") : null;
  const lastWorkout = p?.last_workout_at ? format(new Date(p.last_workout_at), "MMM d") : null;
  const weightValue = (lb?: number) => (theirWeight ? formatWeightLifted(lb ?? 0, unit) : weightPending ? "…" : "—");
  const weightSub = (n?: number) => (theirWeight ? plural(n ?? 0, "session") : undefined);
  const leagueSub = theirLeague?.qualified && theirLeague.rank < 999
    ? `#${theirLeague.rank} · ${formatLeaguePoints(theirLeague.xp)} pts`
    : undefined;

  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className="flex min-h-10 items-center gap-1 text-xs font-semibold text-muted-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Rankings
      </button>
      {isPending ? <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div> : !p ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Athlete not available.</div>
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-2xl border bg-card p-4">
            <RankAvatar row={{ client_id: p.client_id, display_name: p.display_name, avatar_url: p.avatar_url, xp: theirXp, rank: 0, is_me: isMe }} size="h-14 w-14" />
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5"><span className="truncate text-lg font-black">{p.display_name}</span>{p.is_coach && <CoachTag />}</div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Logging level</div><div className="text-sm font-black uppercase tracking-wide text-primary">{levelForXp(theirXp).current.name}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{Number(theirXp ?? 0).toLocaleString()} lifetime points · {publicBadges.length} milestones</div>
            </div>
          </div>

          {!isMe && myRow && theirRow && (
            <div className="space-y-2">
              <div className="px-1 text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">{monthName} points · head to head</div>
              <VsCard me={myRow} them={theirRow} themName={p.display_name} />
              {live && <CoachFocus me={myRow} title={Number(theirRow.total_points) > Number(myRow.total_points) ? "How to close the gap" : "How to stay ahead"} />}
            </div>
          )}
          {isMe && live && theirRow && <CoachFocus me={theirRow} />}

          <div className="flex items-center justify-end gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Weight units</span>
            <ToggleGroup type="single" value={unit} onValueChange={(v) => v && setUnit(v as WeightUnit)} className="rounded-lg border bg-card p-0.5">
              {(["lb", "kg"] as const).map((u) => (
                <ToggleGroupItem key={u} value={u} aria-label={`Show weight in ${u}`} className="h-9 px-3 text-xs font-bold uppercase data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">{u}</ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <StatTile label="Lifetime workouts" value={lifetimeWorkouts.toLocaleString()} sub={since ? `Training since ${since}` : undefined} />
            <StatTile label={`${monthName} workouts`} value={monthWorkouts.toLocaleString()} sub={leagueSub} />
            <StatTile label={`${monthName} weight lifted`} value={weightValue(theirWeight?.month_lb)} sub={weightSub(theirWeight?.month_sessions)} />
            <StatTile label="Lifetime weight lifted" value={weightValue(theirWeight?.lifetime_lb)} sub={weightSub(theirWeight?.lifetime_sessions)} />
            <StatTile label="Fully logged" value={fullyLogged.toLocaleString()} sub={lifetimeWorkouts > 0 ? `${loggedPct}% of workouts` : undefined} />
            <StatTile label="Last workout" value={lastWorkout ?? "—"} sub={p?.month_workouts_fully_logged != null ? `${p.month_workouts_fully_logged} fully logged in ${monthName}` : undefined} />
          </div>

          {!isMe && (
            <div className="overflow-hidden rounded-2xl border bg-card text-sm">
              <div className="grid grid-cols-3 bg-muted/40 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-muted-foreground">
                <span /><span className="text-center">You</span><span className="truncate text-center">{p.display_name}</span>
              </div>
              {[
                ["Level", levelForXp(myStats.xp).current.name, levelForXp(theirXp).current.name],
                ["Lifetime points", Number(myStats?.xp ?? 0).toLocaleString(), Number(theirXp ?? 0).toLocaleString()],
                ["Lifetime workouts", Number(myStats?.workouts_completed ?? 0).toLocaleString(), lifetimeWorkouts.toLocaleString()],
                [`${monthName} workouts`, myLeague ? String(myLeague.workouts_completed) : "—", String(monthWorkouts)],
                [`${monthName} weight lifted`, myWeight ? formatWeightLifted(myWeight.month_lb, unit) : "—", theirWeight ? formatWeightLifted(theirWeight.month_lb, unit) : "—"],
                ["Lifetime weight lifted", myWeight ? formatWeightLifted(myWeight.lifetime_lb, unit) : "—", theirWeight ? formatWeightLifted(theirWeight.lifetime_lb, unit) : "—"],
                ["Badges", String(myBadgeCount), String(publicBadges.length)],
              ].map(([k, a, b]) => (
                <div key={k} className="grid grid-cols-3 border-t px-3 py-2.5">
                  <span className="text-xs text-muted-foreground">{k}</span>
                  <span className="text-center text-xs font-bold">{a}</span>
                  <span className="text-center text-xs font-bold">{b}</span>
                </div>
              ))}
            </div>
          )}

          <PublicAchievements badges={publicBadges} name={p.display_name} />
        </>
      )}
    </div>
  );
}
const levelAccent = (xp:number) => { const n=levelForXp(xp).current.name; return n.includes("LEGEND")?"border-amber-400":n.includes("ELITE")?"border-violet-400":n.includes("ADVANCED")?"border-sky-400":n.includes("TRAINED")?"border-emerald-400":"border-slate-300"; };

function RankingsView({ myStats, myBadgeCount, selected, onSelectedChange }: {
  myStats: BadgeStats;
  myBadgeCount: number;
  selected: string | null;
  onSelectedChange: (id: string | null) => void;
}) {
  // "This month" or last month's final standings (with boost awards).
  const [view, setView] = useState<"current" | "previous">("current");
  const previousMonth = (() => {
    const [y, m] = leagueToday().split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 2, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
  })();
  const viewerId = usePortalUserId() ?? null;
  const { data = [], isPending } = useQuery({
    queryKey: ["athlete-rankings-monthly-view", view, viewerId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_performance_league", {
        _month: view === "previous" ? previousMonth : null,
        ...(viewerId ? { _as_user: viewerId } : {}),
      });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        ...r,
        xp: Number(r.total_points ?? 0),
        rank: r.rank == null ? 999 : Number(r.rank),
        qualified: Boolean(r.qualified),
        workouts_completed: Number(r.workouts_completed ?? 0),
        fully_logged: Number(r.fully_logged ?? 0),
        strength_score: Number(r.improvement_points ?? 0) * 1000,
      })) as Array<RankRow & BoostLeagueRow & { strength_score: number }>;
    },
  });
  const qualified = data.filter((r) => r.qualified && r.rank <= 10);
  const topPoints = Math.max(0, ...qualified.map((r) => Number(r.total_points ?? 0)));
  const podium = qualified.slice(0, 3);
  const rest = qualified.slice(3);
  const me = data.find((r) => r.is_me);
  const monthLabelDate = view === "previous" ? new Date(previousMonth + "T12:00:00") : new Date();
  const monthName = format(monthLabelDate, "MMMM");
  const finalWeek = view === "current" && (me?.is_final_week ?? isFinalWeek());
  // Boost rows need the RPC shape; null rank -> skip in threat math.
  const boostRows = data.map((r) => ({ ...r, rank: r.rank === 999 ? null : r.rank })) as BoostLeagueRow[];
  const boostMe = boostRows.find((r) => r.is_me);

  if (selected) {
    const toStat = (r?: (typeof data)[number]): LeagueStat | undefined =>
      r ? { workouts_completed: r.workouts_completed, rank: r.rank, qualified: r.qualified, xp: r.xp } : undefined;
    return (
      <CompareView
        clientId={selected}
        myClientId={me?.client_id ?? null}
        myStats={myStats}
        myBadgeCount={myBadgeCount}
        theirLeague={toStat(data.find((r) => r.client_id === selected))}
        myLeague={toStat(me)}
        theirRow={boostRows.find((r) => r.client_id === selected)}
        myRow={boostMe}
        live={view === "current" && !boostMe?.month_closed}
        onBack={() => onSelectedChange(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <SheetHeader className="text-left">
        <SheetTitle>{monthName} {view === "previous" ? "Final Standings" : "Performance League"}</SheetTitle>
        <SheetDescription>{view === "previous" ? "Final results, including Final Week Boost awards." : "Earn points all month. Tap anyone to see where their points come from."}</SheetDescription>
      </SheetHeader>

      <div className="grid grid-cols-2 rounded-xl bg-muted/50 p-1 text-xs font-bold">
        {(["current", "previous"] as const).map((v) => (
          <button key={v} type="button" onClick={() => setView(v)}
            className={cn("min-h-9 rounded-lg transition", view === v ? "bg-background shadow-sm" : "text-muted-foreground")}>
            {v === "current" ? "This month" : format(new Date(previousMonth + "T12:00:00"), "MMMM")}
          </button>
        ))}
      </div>

      <LeagueRecapButton />

      {view === "current" && boostMe?.qualified && (finalWeek
        ? <><BoostHero me={boostMe} rows={boostRows} /><ThreatBanner rows={boostRows} me={boostMe} /></>
        : <BoostTeaser me={boostMe} />)}
      {view === "current" && !boostMe?.qualified && <BoostTeaser />}

      {me && !me.qualified && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
          <div className="text-sm font-black">Bodyweight required to rank</div>
          <div className="mt-1 text-xs leading-relaxed">Log a bodyweight in the app to unlock your leaderboard score. Your latest entry is always used.</div>
        </div>
      )}

      {view === "current" && !finalWeek && <div className="rounded-2xl border bg-muted/20 p-3">
        <div className="text-xs font-black">How to earn points</div>
        <ul className="mt-2 space-y-1">
          {LEAGUE_RULES.map((rule) => (
            <li key={rule.key} className="flex items-baseline justify-between gap-3 text-xs">
              <span>{rule.label}{"note" in rule && rule.note ? <span className="text-muted-foreground"> · {rule.note}</span> : null}</span>
              <span className="shrink-0 font-black text-primary">+{rule.points}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 text-[11px] text-muted-foreground">{LEAGUE_RECORDS_NOTE} Resets on the 1st. Log your bodyweight once to join.</div>
      </div>}

      {isPending ? <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div> : qualified.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">No athletes have qualified for {monthName} yet. Log a bodyweight and complete training to get on the board.</div>
      ) : (
        <>
          <PointsLegend rows={qualified} />
          <div className="grid grid-cols-3 items-end gap-2">
            {[podium[1], podium[0], podium[2]].map((r, i) => r ? (
              <button type="button" onClick={() => onSelectedChange(r.client_id)} key={r.client_id} className={cn("flex flex-col items-center rounded-xl border p-2 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md", r.rank === 1 ? "pb-4 bg-amber-50/70 ring-2 ring-amber-300" : r.rank === 2 ? "bg-slate-50/80" : "bg-orange-50/40", r.is_me && "ring-2 ring-primary")}>
                <div className="mb-1 flex flex-col items-center gap-0.5"><Medal className={cn("h-5 w-5", r.rank === 1 ? "text-yellow-500" : r.rank === 2 ? "text-slate-400" : "text-amber-700")} /><span className="text-[11px] font-black">{r.rank === 1 ? "1ST" : r.rank === 2 ? "2ND" : "3RD"}</span></div>
                <RankAvatar row={r} size={r.rank === 1 ? "h-14 w-14" : "h-11 w-11"} />
                <div className="mt-1 w-full truncate text-xs font-bold">{r.display_name}</div>
                {r.is_coach && <CoachTag className="mt-0.5" />}
                <div className="text-[10px] text-muted-foreground">{r.bodyweight_value ? `${Number(r.bodyweight_value).toFixed(1)} ${r.bodyweight_unit ?? "lb"}` : ""}</div>
                <div className="text-xs font-black text-primary">{formatLeaguePoints(r.xp)} pts</div>
                <RecordBadges row={r} size="xs" center className="mt-1" />
                <PointsBar row={r} max={topPoints} className="mt-1.5" />
                {finalWeek && <RowBoost row={{ ...r, rank: r.rank } as BoostLeagueRow} />}
              </button>
            ) : <div key={i} />)}
          </div>
          <ul className="divide-y overflow-hidden rounded-xl border">
            {rest.map((r) => (
              <li key={r.client_id} onClick={() => onSelectedChange(r.client_id)} className={cn("flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm", r.is_me && "bg-primary/5")}>
                <span className="w-7 text-center font-black text-muted-foreground">#{r.rank}</span>
                <RankAvatar row={r} size="h-9 w-9" />
                <div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-1.5"><span className="truncate font-bold">{r.display_name}{r.is_me ? " (You)" : ""}</span>{r.is_coach && <CoachTag />}</div><div className="text-[10px] text-muted-foreground">{plural(r.workouts_completed, "workout")} · {r.bodyweight_value ? `${Number(r.bodyweight_value).toFixed(1)} ${r.bodyweight_unit ?? "lb"}` : "BW verified"}</div><RecordBadges row={r} size="xs" className="mt-1" /><PointsBar row={r} max={topPoints} className="mt-1.5" />{finalWeek && <RowBoost row={r as BoostLeagueRow} />}</div>
                <span className="text-xs font-black text-primary">{formatLeaguePoints(r.xp)} pts</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {me?.qualified && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Your {monthName}</span><span className="text-lg font-black">#{me.rank}</span></div>
          <div className="mt-1 text-2xl font-black text-primary">{formatLeaguePoints(me.xp)} <span className="text-sm">pts</span></div>
          <MonthBreakdown me={me as BoostLeagueRow} />
          {view === "current" && boostMe && <CoachFocus me={boostMe} className="mt-3" />}
          {(() => {
            const tenth = data.filter((r) => r.qualified && r.rank <= 10).sort((a,b)=>a.rank-b.rank).at(-1);
            const gap = me.rank > 10 && tenth ? Math.max(0, Number(tenth.xp ?? 0) - Number(me.xp ?? 0)) : 0;
            return me.rank > 10 ? (
              <div className="mt-3 rounded-xl bg-background/80 px-3 py-2 text-sm font-bold text-primary">
                {formatLeaguePoints(gap)} pts to crack the Top 10
              </div>
            ) : null;
          })()}
        </div>
      )}

      {view === "current" && finalWeek && <div className="rounded-2xl border bg-muted/20 p-3">
        <div className="text-xs font-black">How to earn points</div>
        <ul className="mt-2 space-y-1">
          {LEAGUE_RULES.map((rule) => (
            <li key={rule.key} className="flex items-baseline justify-between gap-3 text-xs">
              <span>{rule.label}{"note" in rule && rule.note ? <span className="text-muted-foreground"> · {rule.note}</span> : null}</span>
              <span className="shrink-0 font-black text-primary">+{rule.points}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 text-[11px] text-muted-foreground">{LEAGUE_RECORDS_NOTE} Resets on the 1st. Log your bodyweight once to join.</div>
      </div>}

    </div>
  );
}

function RankAvatar({ row, size }: { row: RankRow; size: string }) {
  return (
    <Avatar className={cn(size, "border border-border")}>
      {row.avatar_url && <AvatarImage src={row.avatar_url} alt={row.display_name} />}
      <AvatarFallback className="text-xs font-bold">{row.display_name.slice(0, 1).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

function RankLine({ row, onSelect }: { row: RankRow; onSelect: (id: string) => void }) {
  return (
    <li role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onSelect(row.client_id)} onClick={() => onSelect(row.client_id)} className={cn("flex cursor-pointer items-center gap-3 border-l-4 px-3 py-2 text-sm transition hover:brightness-[0.98]", "border-border bg-card", levelAccent(row.xp), row.is_me && "bg-sky-50/60 ring-1 ring-inset ring-sky-300")}>
      <span className="w-6 text-center font-bold text-muted-foreground">{row.rank}</span>
      <RankAvatar row={row} size="h-8 w-8" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{row.display_name}{row.is_me ? " (You)" : ""}</div>
        <div className="text-[10px] font-bold uppercase text-muted-foreground">{levelForXp(row.xp).current.name}</div>
      </div>
      <span className="text-xs text-muted-foreground">{Number(row?.xp ?? 0).toLocaleString()} XP</span>
    </li>
  );
}
