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
import { MyAchievementsRow, PublicAchievements } from "@/components/portal/achievements-card";
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

export function AthleteLevelCard({ clientId }: { clientId: string }) {
  const { data: events = [], isPending } = useXpEvents(clientId);
  const [open, setOpen] = useState<null | "levels" | "rankings" | "powerlifting">(null);
  const total = events.reduce((s, e) => s + (e.xp || 0), 0);
  const lvl = levelForXp(total);
  const stats = statsFromEvents(events);
  const { data: catalog = [] } = useBadgeCatalog();
  const { data: earned = [] } = useMyAchievements(clientId);
  useEffect(() => { const h=()=>setOpen("levels"); window.addEventListener("jf-open-athlete-levels",h); return () => window.removeEventListener("jf-open-athlete-levels",h); }, []);

  return (
    <>
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
            <span className="min-w-0 flex-1"><span className="block text-sm font-bold leading-tight">Athlete Rankings</span><span className="mt-0.5 block text-[11px] leading-tight text-muted-foreground">Lifetime XP leaderboard</span></span>
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
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-2xl pb-safe-bottom">
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
function RankingsView({ myStats, myBadgeCount }: { myStats: BadgeStats; myBadgeCount: number }) {
  const [selected, setSelected] = useState<string | null>(null);
  const { data = [], isPending } = useQuery({
    queryKey: ["athlete-rankings"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_athlete_rankings", { _limit: 10 });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({ ...r, xp: Number(r.xp), rank: Number(r.rank) })) as RankRow[];
    },
  });
  const top = data.filter((r) => r.rank <= 10);
  const podium = top.slice(0, 3);
  const rest = top.slice(3);
  const me = data.find((r) => r.is_me && r.rank > 10);

  if (selected) return <CompareView clientId={selected} myStats={myStats} myBadgeCount={myBadgeCount} onBack={() => setSelected(null)} />;

  return (
    <div className="space-y-4">
      <SheetHeader className="text-left">
        <SheetTitle>JF Athlete Leaderboard</SheetTitle>
        <SheetDescription>Top 10 by lifetime Athlete XP. Tap an athlete to compare achievements.</SheetDescription><Button variant="outline" className="mt-3 h-10 w-full rounded-xl text-xs font-bold" onClick={() => window.dispatchEvent(new CustomEvent("jf-open-athlete-levels"))}><Info className="mr-2 h-4 w-4 text-primary" /> View Athlete Levels ›</Button>
      </SheetHeader>
      {isPending ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-3 items-end gap-2">
            {[podium[1], podium[0], podium[2]].map((r, i) =>
              r ? (
                <button type="button" onClick={() => setSelected(r.client_id)} key={r.client_id} className={cn("flex flex-col items-center rounded-xl border p-2 text-center",
                  r.rank === 1 ? "border-primary bg-primary/10 pb-4" : "border-border", r.is_me && "ring-2 ring-primary")}>
                  <Medal className={cn("mb-1 h-5 w-5", r.rank === 1 ? "text-primary" : "text-muted-foreground")} />
                  <RankAvatar row={r} size={r.rank === 1 ? "h-14 w-14" : "h-11 w-11"} />
                  <div className="mt-1 w-full truncate text-xs font-bold">{r.display_name}</div>
                  <div className="text-[10px] uppercase text-primary">{levelForXp(r.xp).current.name}</div>
                  <div className="text-[10px] text-muted-foreground">{r.xp.toLocaleString()} XP</div>
                </button>
              ) : <div key={i} />,
            )}
          </div>
          <ul className="divide-y rounded-xl border">
            {rest.map((r) => <RankLine key={r.client_id} row={r} onSelect={setSelected} />)}
          </ul>
          {me && (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Your rank</div>
              <ul className="rounded-xl border border-primary"><RankLine row={me} onSelect={setSelected} /></ul>
            </div>
          )}
        </>
      )}
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
    <li role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onSelect(row.client_id)} onClick={() => onSelect(row.client_id)} className={cn("flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40", row.is_me && "bg-primary/10")}>
      <span className="w-6 text-center font-bold text-muted-foreground">{row.rank}</span>
      <RankAvatar row={row} size="h-8 w-8" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{row.display_name}{row.is_me ? " (You)" : ""}</div>
        <div className="text-[10px] uppercase text-primary">{levelForXp(row.xp).current.name}</div>
      </div>
      <span className="text-xs text-muted-foreground">{row.xp.toLocaleString()} XP</span>
    </li>
  );
}


function PowerliftingRecordsView() {
  const [tab, setTab] = useState<"gl"|"dots"|"total"|"squat"|"bench"|"deadlift">("gl");
  const { data = [], isPending, error } = useQuery({
    queryKey: ["powerlifting-rankings"], staleTime: 5 * 60_000,
    queryFn: async () => { const { data, error } = await (supabase as any).rpc("get_powerlifting_rankings"); if (error) throw error; return (data ?? []) as any[]; },
  });
  const { data: roster = [] } = useQuery({
    queryKey: ["powerlifting-athlete-roster"], staleTime: 5 * 60_000,
    queryFn: async () => { const { data, error } = await (supabase as any).rpc("get_powerlifting_athlete_roster"); if (error) throw error; return (data ?? []) as any[]; },
  });
  const pointSystem = (r:any) => String(r.points_system||"").toUpperCase();
  const value = (r:any) => tab==="gl"||tab==="dots" ? Number(r.points??0) : Number(r[tab==="total"?"total_kg":tab+"_kg"]??0);
  const eligible = data.filter((r:any)=> tab==="gl" ? pointSystem(r)==="GL" : tab==="dots" ? pointSystem(r)==="DOTS" : true);
  const ordered=[...eligible].filter((r:any)=>value(r)>0).sort((a:any,b:any)=>value(b)-value(a));
  const seen=new Set<string>();
  const sorted=ordered.filter((r:any)=>{const key=r.athlete_id||r.client_id||String(r.athlete_name||"").toLowerCase();if(seen.has(key))return false;seen.add(key);return true}).slice(0,10);
  const represented=new Set(data.map((r:any)=>r.athlete_id).filter(Boolean));
  const awaiting=roster.filter((a:any)=>!represented.has(a.athlete_id));
  const tabs=[["gl","GL Points"],["dots","DOTS"],["total","Total"],["squat","Squat"],["bench","Bench"],["deadlift","Deadlift"]] as const;
  return <div className="space-y-4">
    <SheetHeader className="text-left">
      <SheetTitle>JF Powerlifting Records</SheetTitle>
      <SheetDescription>See the best competition results achieved while each athlete was coached by JF. One athlete can only hold one spot on each leaderboard. Use GL Points first for strength relative to bodyweight, or switch to DOTS, Total, Squat, Bench or Deadlift.</SheetDescription>
    </SheetHeader>
    <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1 sm:grid-cols-6">{tabs.map(([k,label])=><button key={k} type="button" onClick={()=>setTab(k)} className={cn("rounded-lg px-2 py-2 text-[11px] font-bold",tab===k?"bg-background shadow-sm":"text-muted-foreground")}>{label}</button>)}</div>
    {(tab==="gl"||tab==="dots")&&<div className="rounded-xl border bg-muted/20 px-3 py-2 text-xs text-muted-foreground"><b className="text-foreground">{tab==="gl"?"GL Points":"DOTS"}:</b> a bodyweight-adjusted score used to compare powerlifting performances across different bodyweights. Higher is better.</div>}
    {isPending?<div className="py-8 text-center text-sm text-muted-foreground">Loading records…</div>:error?<div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"><div className="font-bold text-destructive">Records could not load</div><div className="mt-1 text-xs text-muted-foreground">Please try again. If this continues, staff can manage the saved athlete data from Athlete Records.</div></div>:sorted.length===0?<div className="rounded-xl border p-6 text-center text-sm text-muted-foreground">No saved {tab==="gl"?"GL Points":tab==="dots"?"DOTS":tab} results are available for qualifying JF meets yet.</div>:<div className="overflow-hidden rounded-2xl border bg-card">{sorted.map((r:any,i)=><div key={r.id} className="flex items-center gap-3 border-b p-3 last:border-0"><div className="w-6 text-center text-sm font-black text-muted-foreground">{i+1}</div><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{r.athlete_name}</div><div className="text-[10px] font-bold uppercase text-primary">{r.sex} · {r.competition_level||"competitor"}</div><div className="truncate text-[10px] text-muted-foreground">{r.meet_location||r.meet_name||"Meet"}{r.meet_date?` · ${new Date(r.meet_date+"T00:00:00").getFullYear()}`:""}</div></div><div className="text-right"><div className="text-sm font-black">{tab==="gl"||tab==="dots"?`${Number(r.points).toFixed(2)} ${tab==="gl"?"GL":"DOTS"}`:`${Number(r[tab==="total"?"total_kg":tab+"_kg"])} kg`}</div><div className="text-[10px] text-muted-foreground">S {r.squat_kg} · B {r.bench_kg} · D {r.deadlift_kg}</div></div></div>)}</div>}
    {!isPending&&roster.length>0&&<div className="rounded-2xl border bg-card p-4"><div className="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">JF Powerlifting Roster</div><div className="mt-1 text-sm font-semibold">{roster.length} athletes tracked</div>{awaiting.length>0&&<div className="mt-3 border-t pt-3"><div className="mb-2 text-[11px] font-bold text-muted-foreground">Athletes still needing qualifying meet data</div><div className="flex flex-wrap gap-1.5">{awaiting.map((a:any)=><span key={a.athlete_id} className="rounded-full border bg-muted/30 px-2 py-1 text-[10px] font-semibold">{a.athlete_name}</span>)}</div></div>}</div>}
  </div>;
}