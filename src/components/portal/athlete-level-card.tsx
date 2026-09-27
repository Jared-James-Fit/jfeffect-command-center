import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Info, Trophy, Medal, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ATHLETE_LEVELS, XP_RULES, levelForXp } from "@/lib/athlete-level";
import { cn } from "@/lib/utils";
import { useBadgeCatalog, useMyAchievements, usePublicAchievements, type AchievementMetrics } from "@/lib/athlete-achievements";
import { AchievementCelebrations, MyAchievementsRow, PublicAchievements } from "@/components/portal/achievements-card";
import { ArrowLeft } from "lucide-react";

type XpEvent = { id: string; event_type: string; label: string | null; xp: number; occurred_at: string };
type RankRow = { client_id: string; display_name: string; avatar_url: string | null; xp: number; rank: number; is_me: boolean };

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

export function AthleteLevelCard({ clientId, defaultView = null }: { clientId: string; defaultView?: null | "rankings" }) {
  const { data: events = [], isPending } = useXpEvents(clientId);
  const [open, setOpen] = useState<null | "levels" | "rankings" | "powerlifting">(defaultView);
  const total = events.reduce((s, e) => s + (e.xp || 0), 0);
  const lvl = levelForXp(total);
  const stats = statsFromEvents(events);
  const { data: catalog = [] } = useBadgeCatalog();
  const { data: earned = [] } = useMyAchievements(clientId);
  useEffect(() => { const h=()=>setOpen("levels"); window.addEventListener("jf-open-athlete-levels",h); return () => window.removeEventListener("jf-open-athlete-levels",h); }, []);

  return (
    <>
      <AchievementCelebrations clientId={clientId} catalog={catalog} earned={earned} />
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Athlete Level</div>
            <div className="mt-0.5 text-2xl font-black uppercase tracking-tight text-primary">
              {isPending ? "—" : lvl.current.name}
            </div>
            <div className="text-xs text-muted-foreground">{lvl.xp.toLocaleString()} lifetime XP</div>
          </div>

        </div>
        <Progress value={lvl.pct} className="mt-3 h-2" />
        <div className="mt-1.5 text-xs text-muted-foreground">
          {lvl.next ? `${lvl.remaining.toLocaleString()} XP to ${lvl.next.name}` : "Top level reached — keep building your legacy."}
        </div>
        <div className="mt-4 overflow-hidden rounded-2xl border bg-muted/20">
          <button type="button" onClick={() => setOpen("rankings")} className="flex min-h-14 w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-muted/40 active:bg-muted/60">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Trophy className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-bold leading-tight">Athlete Rankings</span><span className="mt-0.5 block text-[11px] leading-tight text-muted-foreground">Monthly Top 15 · bodyweight required</span></span>
            <span className="shrink-0 text-xl font-semibold text-primary">›</span>
          </button>
          <button type="button" onClick={() => setOpen("powerlifting")} className="flex min-h-14 w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-muted/40 active:bg-muted/60">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Medal className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-bold leading-tight">Powerlifting Records</span><span className="mt-0.5 block text-[11px] leading-tight text-muted-foreground">DOTS, total & competition PRs</span></span>
            <span className="shrink-0 text-xl font-semibold text-primary">›</span>
          </button>
        </div>
        <MyAchievementsRow catalog={catalog} earned={earned} metrics={stats} />
      </Card>

      <Sheet open={open === "levels" || open === "rankings"} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-2xl px-5 pb-safe-bottom pt-5">
          {open === "levels" ? <LevelsView total={lvl.xp} events={events} />
            : open === "rankings" ? <RankingsView myStats={stats} myBadgeCount={earned.length} />
            : null}
        </SheetContent>
      </Sheet>

      <Sheet open={open === "powerlifting"} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-2xl px-5 pb-safe-bottom pt-5">
          <div className="min-h-[320px]">
            <PowerliftingRecordsView />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function LevelsView({ total, events }: { total: number; events: XpEvent[] }) {
  const lvl = levelForXp(total);
  return (
    <div className="space-y-5">
      <SheetHeader className="text-left">
        <SheetTitle>Athlete Levels</SheetTitle>
        <SheetDescription>Lifetime progression. Your level never goes down.</SheetDescription>
      </SheetHeader>
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
              <span className="text-xs text-muted-foreground">{l.min.toLocaleString()} XP</span>
            </li>
          );
        })}
      </ul>
      <div>
        <div className="mb-2 text-sm font-semibold">How to earn XP</div>
        <ul className="space-y-1.5 text-sm">
          {XP_RULES.map((r) => (
            <li key={r.label} className="flex items-center justify-between">
              <span className="text-muted-foreground">{r.label}</span>
              <span className="font-bold text-primary">+{r.xp}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="mb-2 text-sm font-semibold">XP History</div>
        {events.length === 0 ? (
          <div className="text-sm text-muted-foreground">Finish a workout to earn your first XP.</div>
        ) : (
          <ul className="divide-y text-sm">
            {events.slice(0, 20).map((e) => (
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
  return {
    xp: events.reduce((s, e) => s + (e.xp || 0), 0),
    workouts_completed: done.length,
    workouts_fully_logged: events.filter((e) => e.event_type === "workout_fully_logged").length,
    days_since_first_workout: first ? (Date.now() - new Date(first).getTime()) / 86_400_000 : 0,
  };
}

function CompareView({ clientId, myStats, myBadgeCount, onBack }: { clientId: string; myStats: BadgeStats; myBadgeCount: number; onBack: () => void }) {
  const { data: p, isPending } = useQuery({
    queryKey: ["athlete-public-profile", clientId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_athlete_public_profile", { _client_id: clientId });
      if (error) throw error;
      return ((data ?? [])[0] ?? null) as any;
    },
  });
  const theirXp = Number(p?.xp ?? 0);
  const { data: publicBadges = [] } = usePublicAchievements(clientId);

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
            <RankAvatar row={{ client_id: p.client_id, display_name: p.display_name, avatar_url: p.avatar_url, xp: theirXp, rank: 0, is_me: p.is_me }} size="h-14 w-14" />
            <div className="min-w-0">
              <div className="truncate text-lg font-black">{p.display_name}</div>
              <div className="text-xs font-black uppercase tracking-wide text-primary">{levelForXp(theirXp).current.name}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{theirXp.toLocaleString()} lifetime XP · {publicBadges.length} achievements</div>
            </div>
          </div>

          {!p.is_me && (
            <div className="overflow-hidden rounded-2xl border bg-card text-sm">
              <div className="grid grid-cols-3 bg-muted/40 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-muted-foreground">
                <span /><span className="text-center">You</span><span className="truncate text-center">{p.display_name}</span>
              </div>
              {[
                ["Level", levelForXp(myStats.xp).current.name, levelForXp(theirXp).current.name],
                ["Lifetime XP", myStats.xp.toLocaleString(), theirXp.toLocaleString()],
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

function RankingsView({ myStats, myBadgeCount }: { myStats: BadgeStats; myBadgeCount: number }) {
  const [selected, setSelected] = useState<string | null>(null);
  const { data = [], isPending } = useQuery({
    queryKey: ["athlete-rankings-monthly"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_monthly_athlete_rankings", { _limit: 15 });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        ...r,
        xp: Number(r.monthly_xp ?? 0),
        rank: r.rank == null ? 999 : Number(r.rank),
        qualified: Boolean(r.qualified),
        workouts_completed: Number(r.workouts_completed ?? 0),
        fully_logged: Number(r.fully_logged ?? 0),
        strength_score: Number(r.strength_score ?? 0),
      })) as Array<RankRow & { qualified:boolean; bodyweight_value:number|null; bodyweight_unit:string|null; workouts_completed:number; fully_logged:number; strength_score:number }>;
    },
  });
  const qualified = data.filter((r) => r.qualified && r.rank <= 15);
  const podium = qualified.slice(0, 3);
  const rest = qualified.slice(3);
  const me = data.find((r) => r.is_me);
  const monthName = format(new Date(), "MMMM");

  if (selected) return <CompareView clientId={selected} myStats={myStats} myBadgeCount={myBadgeCount} onBack={() => setSelected(null)} />;

  return (
    <div className="space-y-4">
      <SheetHeader className="text-left">
        <SheetTitle>{monthName} Performance Leaderboard</SheetTitle>
        <SheetDescription>Top 15 clients this month. Monthly XP resets on the 1st so every client gets a fresh shot.</SheetDescription>
      </SheetHeader>

      {me && !me.qualified && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
          <div className="text-sm font-black">Bodyweight required to rank</div>
          <div className="mt-1 text-xs leading-relaxed">Log a bodyweight in the app to unlock your leaderboard score. Your latest entry is always used.</div>
        </div>
      )}

      <div className="grid grid-cols-4 gap-2 rounded-2xl border bg-muted/20 p-3 text-center">
        <div><div className="text-lg font-black">1,000</div><div className="text-[9px] uppercase tracking-wide text-muted-foreground">Max XP</div></div>
        <div><div className="text-lg font-black">600</div><div className="text-[9px] uppercase tracking-wide text-muted-foreground">Training</div></div>\n        <div><div className="text-lg font-black">200</div><div className="text-[9px] uppercase tracking-wide text-muted-foreground">Strength</div></div>\n        <div><div className="text-lg font-black">200</div><div className="text-[9px] uppercase tracking-wide text-muted-foreground">Logs + BW</div></div>
      </div>

      {isPending ? <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div> : qualified.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">No athletes have qualified for {monthName} yet. Log a bodyweight and complete training to get on the board.</div>
      ) : (
        <>
          <div className="grid grid-cols-3 items-end gap-2">
            {[podium[1], podium[0], podium[2]].map((r, i) => r ? (
              <button type="button" onClick={() => setSelected(r.client_id)} key={r.client_id} className={cn("flex flex-col items-center rounded-xl border p-2 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md", r.rank === 1 ? "pb-4 bg-amber-50/70 ring-2 ring-amber-300" : r.rank === 2 ? "bg-slate-50/80" : "bg-orange-50/40", r.is_me && "ring-2 ring-primary")}>
                <div className="mb-1 flex flex-col items-center gap-0.5"><Medal className={cn("h-5 w-5", r.rank === 1 ? "text-yellow-500" : r.rank === 2 ? "text-slate-400" : "text-amber-700")} /><span className="text-[11px] font-black">{r.rank === 1 ? "1ST" : r.rank === 2 ? "2ND" : "3RD"}</span></div>
                <RankAvatar row={r} size={r.rank === 1 ? "h-14 w-14" : "h-11 w-11"} />
                <div className="mt-1 w-full truncate text-xs font-bold">{r.display_name}</div>
                <div className="text-[10px] text-muted-foreground">{r.bodyweight_value ? `${Number(r.bodyweight_value).toFixed(1)} ${r.bodyweight_unit ?? "lb"}` : ""}</div>
                <div className="text-xs font-black text-primary">{r.xp.toLocaleString()} XP</div>
              </button>
            ) : <div key={i} />)}
          </div>
          <ul className="divide-y overflow-hidden rounded-xl border">
            {rest.map((r) => (
              <li key={r.client_id} onClick={() => setSelected(r.client_id)} className={cn("flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm", r.is_me && "bg-primary/5")}>
                <span className="w-7 text-center font-black text-muted-foreground">#{r.rank}</span>
                <RankAvatar row={r} size="h-9 w-9" />
                <div className="min-w-0 flex-1"><div className="truncate font-bold">{r.display_name}{r.is_me ? " (You)" : ""}</div><div className="text-[10px] text-muted-foreground">{r.workouts_completed} workouts · {r.bodyweight_value ? `${Number(r.bodyweight_value).toFixed(1)} ${r.bodyweight_unit ?? "lb"}` : "BW verified"}</div></div>
                <span className="text-xs font-black text-primary">{r.xp} XP</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {me?.qualified && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Your {monthName}</span><span className="text-lg font-black">#{me.rank}</span></div>
          <div className="mt-1 text-2xl font-black text-primary">{me.xp} <span className="text-sm">XP</span></div>
          <div className="mt-1 text-xs text-muted-foreground">{me.workouts_completed} workouts · {me.fully_logged} fully logged · {me.strength_score} strength XP · BW verified</div>
          <Progress value={Math.min(100, me.xp / 10)} className="mt-3 h-2" />
        </div>
      )}

      <div className="rounded-xl border bg-muted/20 p-3 text-[11px] leading-relaxed text-muted-foreground">
        <span className="font-bold text-foreground">How scoring works:</span> complete programmed workouts for up to 600 XP, fully log training for up to 150 XP, and earn up to 200 strength XP from bodyweight-normalized e1RM improvements versus your own pre-month history. Only your four best exercise improvements count and each is capped at 50 XP. Having a bodyweight logged earns 50 XP and is required to rank; your latest entry is always used. Total score caps at 1,000, preventing unlimited volume or exercise farming. Lifetime Athlete XP and Powerlifting Records remain separate.
      </div>
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
      <span className="text-xs text-muted-foreground">{row.xp.toLocaleString()} XP</span>
    </li>
  );
}


function PowerliftingRecordsView() {
  const [tab, setTab] = useState<"gl"|"dots"|"total"|"squat"|"bench"|"deadlift">("gl");
  const [division, setDivision] = useState<"male"|"female">("male");
  const [selectedAthlete, setSelectedAthlete] = useState<any|null>(null);
  const { data = [], isPending, error } = useQuery({
    queryKey: ["powerlifting-rankings"], staleTime: 5 * 60_000,
    queryFn: async () => { const { data, error } = await (supabase as any).rpc("get_powerlifting_rankings"); if (error) throw error; return (data ?? []) as any[]; },
  });
  const { data: roster = [] } = useQuery({
    queryKey: ["powerlifting-athlete-roster"], staleTime: 5 * 60_000,
    queryFn: async () => { const { data, error } = await (supabase as any).rpc("get_powerlifting_athlete_roster"); if (error) throw error; return (data ?? []) as any[]; },
  });
  const pointSystem = (r:any) => String(r.points_system||"").toUpperCase();
  const value = (r:any) => tab==="gl" ? Number(r.gl_points??0) : tab==="dots" ? Number(r.dots_points??0) : Number(r[tab==="total"?"total_kg":tab+"_kg"]??0);
  const eligible = data.filter((r:any)=> String(r.sex).toLowerCase()===division);
  const ordered=[...eligible].filter((r:any)=>value(r)>0).sort((a:any,b:any)=>value(b)-value(a));
  const seen=new Set<string>();
  const sorted=ordered.filter((r:any)=>{const key=r.athlete_id||r.client_id||String(r.athlete_name||"").toLowerCase();if(seen.has(key))return false;seen.add(key);return true}).slice(0,10);
  const represented=new Set(data.map((r:any)=>r.athlete_id).filter(Boolean));
  const awaiting=roster.filter((a:any)=>!represented.has(a.athlete_id));
  const tabs=[["gl","GL Points"],["dots","DOTS"],["total","Total"],["squat","Squat"],["bench","Bench"],["deadlift","Deadlift"]] as const;
  return <div className="space-y-4">
    <SheetHeader className="text-left">
      <SheetTitle>JF Powerlifting Records</SheetTitle>
      <SheetDescription>Verified JF-coached meet records. One athlete, one spot. Tap a category for their best.</SheetDescription>
    </SheetHeader>
    <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">{([["male","Men"],["female","Women"]] as const).map(([k,label])=><button key={k} type="button" onClick={()=>setDivision(k)} className={cn("rounded-lg px-2 py-2 text-xs font-bold",division===k?"bg-background text-foreground shadow-sm":"text-muted-foreground")}>{label}</button>)}</div>
    <div className="flex items-center justify-between px-1"><span className="text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">Top 10</span><span className="text-[10px] font-semibold text-muted-foreground">{division==="male"?"Men":"Women"} · {tab==="gl"?"GL Points":tab==="dots"?"DOTS":tab[0].toUpperCase()+tab.slice(1)}</span></div>
    <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1 sm:grid-cols-6">{tabs.map(([k,label])=><button key={k} type="button" onClick={()=>setTab(k)} className={cn("rounded-lg px-2 py-2 text-[11px] font-bold",tab===k?"bg-background shadow-sm":"text-muted-foreground")}>{label}</button>)}</div>
    {(tab==="gl"||tab==="dots")&&<div className="rounded-xl border bg-muted/20 px-3 py-2 text-xs text-muted-foreground"><b className="text-foreground">{tab==="gl"?"GL Points":"DOTS"}:</b> a bodyweight-adjusted score used to compare powerlifting performances across different bodyweights. Higher is better.</div>}
    {isPending?<div className="py-8 text-center text-sm text-muted-foreground">Loading records…</div>:error?<div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"><div className="font-bold text-destructive">Records could not load</div><div className="mt-1 text-xs text-muted-foreground">Please try again. If this continues, staff can manage the saved athlete data from Athlete Records.</div></div>:sorted.length===0?<div className="rounded-xl border p-6 text-center text-sm text-muted-foreground">No saved {tab==="gl"?"GL Points":tab==="dots"?"DOTS":tab} results are available for qualifying JF meets yet.</div>:<div className="overflow-hidden rounded-2xl border bg-card">{sorted.map((r:any,i)=><div key={r.id} className="flex items-center gap-3 border-b p-3 last:border-0"><div className="w-6 text-center text-sm font-black text-muted-foreground">{i+1}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><button type="button" onClick={()=>setSelectedAthlete(r)} className="truncate text-left text-sm font-bold hover:text-primary hover:underline">{r.athlete_name}</button>{r.arenapl_url&&<a href={r.arenapl_url} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[8px] font-black tracking-wide text-muted-foreground hover:text-primary" aria-label={`Open ${r.athlete_name} on ArenaPL`}>ARENA ↗</a>}</div><div className="text-[10px] font-bold uppercase text-primary">{r.weight_class_kg?`${r.weight_class_kg} KG · `:""}{r.sex} · {r.competition_level||"competitor"}</div><div className="truncate text-[10px] text-muted-foreground">{r.meet_location||r.meet_name||"Meet"}{r.meet_date?` · ${new Date(r.meet_date+"T00:00:00").getFullYear()}`:""}</div></div><div className="text-right"><div className="text-sm font-black">{tab==="gl"||tab==="dots"?`${value(r).toFixed(2)} ${tab==="gl"?"GL":"DOTS"}`:`${Number(r[tab==="total"?"total_kg":tab+"_kg"])} kg`}</div><div className="text-[10px] text-muted-foreground">S {r.squat_kg} · B {r.bench_kg} · D {r.deadlift_kg}</div></div></div>)}</div>}
    <Sheet open={!!selectedAthlete} onOpenChange={(o)=>!o&&setSelectedAthlete(null)}><SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-2xl pb-safe-bottom"><button type="button" onClick={()=>setSelectedAthlete(null)} className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-xl border bg-card px-3 text-sm font-bold shadow-sm"><ArrowLeft className="h-4 w-4" /> Back to records</button>{selectedAthlete&&(()=>{const athleteRows=data.filter((x:any)=>(x.athlete_id||x.client_id)===(selectedAthlete.athlete_id||selectedAthlete.client_id));const classes=[...new Set(athleteRows.map((x:any)=>x.weight_class_kg).filter(Boolean))];return <div className="space-y-4"><SheetHeader className="text-left"><SheetTitle>{selectedAthlete.athlete_name}</SheetTitle><SheetDescription>JF-coached competition bests by weight class.</SheetDescription></SheetHeader>{selectedAthlete.arenapl_url&&<a href={selectedAthlete.arenapl_url} target="_blank" rel="noreferrer" className="inline-flex rounded-lg border px-3 py-2 text-xs font-black text-primary">Open Arena Powerlifting ↗</a>}{classes.map((wc:any)=>{const rows=athleteRows.filter((x:any)=>x.weight_class_kg===wc);const best=(key:string)=>rows.reduce((a:any,b:any)=>Number(b[key]||0)>Number(a?.[key]||0)?b:a,null);return <div key={wc} className="rounded-2xl border bg-card p-4"><div className="mb-3 text-sm font-black">{wc} kg class</div><div className="grid grid-cols-3 gap-2 text-center">{[["Squat","squat_kg"],["Bench","bench_kg"],["Deadlift","deadlift_kg"],["Total","total_kg"],["GL","gl_points"],["DOTS","dots_points"]].map(([label,key])=>{const r=best(key);return <div key={key} className="rounded-xl bg-muted/40 p-2"><div className="text-[9px] font-bold uppercase text-muted-foreground">{label}</div><div className="text-sm font-black">{r?Number(r[key]).toFixed(key.includes("points")?2:1):"—"}{r&&!key.includes("points")?" kg":""}</div><div className="truncate text-[8px] text-muted-foreground">{r?.meet_date?new Date(r.meet_date+"T00:00:00").getFullYear():""}</div></div>})}</div></div>})}</div>})()}</SheetContent></Sheet>
    {!isPending&&roster.length>0&&<div className="rounded-2xl border bg-card p-4"><div className="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">JF Powerlifting Roster</div><div className="mt-1 text-sm font-semibold">{roster.length} athletes tracked</div>{awaiting.length>0&&<div className="mt-3 border-t pt-3"><div className="mb-2 text-[11px] font-bold text-muted-foreground">Athletes still needing qualifying meet data</div><div className="flex flex-wrap gap-1.5">{awaiting.map((a:any)=><span key={a.athlete_id} className="rounded-full border bg-muted/30 px-2 py-1 text-[10px] font-semibold">{a.athlete_name}</span>)}</div></div>}</div>}
  </div>;
}