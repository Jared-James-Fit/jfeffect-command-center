// Production deploy marker: 2026-09-28 performance-rating rebuild v2
import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Trophy, ChevronRight, Scale, ArrowLeft, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { combinedBodyweightQueryKey, getCombinedBodyweightSeries } from "@/lib/bodyweight";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PublicAchievements } from "@/components/portal/achievements-card";
import { usePublicAchievements } from "@/lib/athlete-achievements";
import { levelForXp } from "@/lib/athlete-level";

type Row = { client_id:string; display_name:string; avatar_url:string|null; monthly_xp:number; rank:number|null; is_me:boolean; qualified:boolean; bodyweight_value:number|null; bodyweight_unit:string|null; strength_score?:number; workouts_completed?:number; fully_logged?:number };
const rating=(r?:Row|null)=>Number(r?.monthly_xp??0)/1000;

export function PerformanceLeagueCard({ clientId, userId }: { clientId:string; userId:string }) {
  const [open, setOpen] = useState(false);
  const { data: roleRows = [] } = useQuery({
    queryKey:["current-user-roles", userId],
    enabled:!!userId,
    queryFn:async()=>{ const {data,error}=await (supabase as any).from("user_roles").select("role").eq("user_id",userId); if(error) throw error; return data ?? []; }
  });
  const isAdmin = roleRows.some((r:any)=>r.role === "admin");
  const { data = [], isPending } = useQuery({
    queryKey:["athlete-rankings-monthly"],
    staleTime:60_000,
    queryFn:async()=>{ const {data,error}=await (supabase as any).rpc("get_monthly_athlete_rankings",{_limit:50}); if(error) throw error; return (data??[]) as Row[]; }
  });
  const me=data.find(r=>r.client_id===clientId) ?? data.find(r=>r.is_me);
  const { data: localBodyweights = [] } = useQuery({ queryKey: combinedBodyweightQueryKey(userId), enabled: !!userId, queryFn: () => getCombinedBodyweightSeries(userId, 200) });
  const latestLocalWeight = localBodyweights.length ? localBodyweights[localBodyweights.length - 1] : null;
  return <>
    <Card className="overflow-hidden">
      <button type="button" onClick={()=>setOpen(true)} className="w-full p-4 text-left transition-colors hover:bg-muted/30 active:bg-muted/50">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Trophy className="h-5 w-5"/></div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground">{format(new Date(),"MMMM")} · Performance League</div>
            <div className="mt-0.5 truncate text-sm font-black sm:text-base">JF Performance League</div>
          </div>
          {isPending ? <div className="h-8 w-16 shrink-0 animate-pulse rounded-lg bg-muted"/> : me?.qualified ? <div className="grid shrink-0 grid-cols-[auto_1px_auto] items-center gap-2">
            <div className="min-w-[34px] text-center">
              <div className="text-[8px] font-bold uppercase tracking-wide text-muted-foreground">Rank</div>
              <div className="text-base font-black leading-none text-primary">{me.rank ? `#${me.rank}` : "—"}</div>
            </div>
            <div className="h-7 w-px bg-border"/>
            <div className="min-w-[38px] text-center">
              <div className="text-[8px] font-bold uppercase tracking-wide text-muted-foreground">Score</div>
              <div className="text-base font-black leading-none">{rating(me).toFixed(1)}</div>
            </div>
          </div> : null}
          <ChevronRight className="h-4 w-4 shrink-0 text-primary"/>
        </div>
        {!isPending && !me?.qualified && <div className="mt-3 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-amber-950"><Scale className="h-4 w-4 shrink-0"/><div className="text-[11px] font-bold">Log bodyweight to enter the league</div></div>}
      </button>
    </Card>
    {open && typeof document !== "undefined" ? createPortal(<LeaderboardOverlay onClose={()=>setOpen(false)} rows={data} loading={isPending} isAdmin={isAdmin}/>, document.body) : null}
  </>;
}

function LeaderboardOverlay({onClose,rows,loading,isAdmin}:{onClose:()=>void;rows:Row[];loading:boolean;isAdmin:boolean}) {
  const [selected,setSelected]=useState<Row|null>(null);
  const ranked=rows.filter(r=>r.qualified && r.rank!=null).sort((a,b)=>Number(a.rank)-Number(b.rank)).slice(0,isAdmin ? undefined : 10);
  if(selected) return <AthleteProfileOverlay row={selected} onBack={()=>setSelected(null)} onClose={onClose}/>;
  return <div role="dialog" aria-modal="true" className="fixed inset-0 z-[9999] bg-background">
    <div className="mx-auto h-full max-w-2xl overflow-y-auto px-4 pb-24 pt-[max(5.5rem,calc(env(safe-area-inset-top)+1.5rem))]">
      <div className="sticky top-0 z-10 -mx-4 flex min-h-[64px] items-center gap-3 border-b bg-background/95 px-4 py-2 backdrop-blur">
        <button type="button" onClick={onClose} aria-label="Back to home" className="flex h-11 shrink-0 items-center gap-2 rounded-xl border bg-card px-3 font-bold shadow-sm"><ArrowLeft className="h-5 w-5"/><span>Back</span></button>
        <div><div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{format(new Date(),"MMMM")} Performance League</div><div className="text-lg font-black">JF Performance League</div><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Top 10</div></div>
      </div>
      <div className="mt-4 rounded-2xl border bg-muted/20 p-4 text-xs leading-relaxed text-muted-foreground">
        <div className="mb-2 flex items-center gap-2 font-black text-foreground"><Info className="h-4 w-4 text-primary"/>How you rank</div>
        <div><b>100 base points + up to 10 performance bonus:</b> 40 workouts, 25 fully logged training, 25 performance improvement, and 10 bodyweight tracking.</div>
        <div className="mt-2"><b>How to score:</b> Complete your programmed workouts, fully log your sets, beat your previous performance on the same exercises, and log bodyweight consistently. Exceptional improvement can push your score above 100. Highest Performance Score takes #1.</div>
      </div>
      {loading ? <div className="py-10 text-center text-sm text-muted-foreground">Loading leaderboard…</div> :
       <div className="mt-4 space-y-2">{ranked.map(r=><button type="button" onClick={()=>setSelected(r)} key={r.client_id} className={"flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors active:bg-muted/60 "+(r.is_me?"bg-primary/5 ring-1 ring-primary/30":"bg-card")}>
         <div className="w-9 text-center text-lg font-black text-primary">#{r.rank}</div>
         <Avatar className="h-11 w-11"><AvatarImage src={r.avatar_url??undefined}/><AvatarFallback>{(r.display_name||"?").slice(0,1)}</AvatarFallback></Avatar>
         <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><div className="truncate font-bold">{r.display_name}{r.is_me?" (You)":""}</div><ChevronRight className="h-4 w-4 shrink-0 text-primary"/></div><div className="text-[11px] text-muted-foreground">{r.bodyweight_value?Number(r.bodyweight_value).toFixed(1)+" "+(r.bodyweight_unit??"lb"):"Bodyweight verified"} · Tap for profile</div></div>
         <div className="text-right"><div className="text-lg font-black text-primary">{rating(r).toFixed(1)}</div><div className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Score</div></div>
       </button>)}</div>}
      <div className="mt-3 text-center text-[11px] text-muted-foreground">{isAdmin ? "Admin view · Full ranked list" : "Top 10 · Tap an athlete to view their profile and achievements."}</div>
    </div>
  </div>;
}

function AthleteProfileOverlay({row,onBack,onClose}:{row:Row;onBack:()=>void;onClose:()=>void}) {
  const {data:badges=[]}=usePublicAchievements(row.client_id);
  const { data: xpEvents = [] } = useQuery({
    queryKey: ["athlete-xp-public", row.client_id],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("athlete_xp_events").select("xp").eq("client_id", row.client_id);
      if (error) throw error;
      return data ?? [];
    },
  });
  // Defensive normalization: Safari will throw when an unexpected/null XP
  // payload leaks through and a formatter is called on it. Public athlete
  // profiles must never be able to crash the entire Performance League card.
  const loggingXpRaw = xpEvents.reduce((sum: number, event: any) => {
    const n = Number(event?.xp);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
  const loggingXp = Number.isFinite(loggingXpRaw) ? loggingXpRaw : 0;
  const loggingLevel = levelForXp(loggingXp)?.current ?? { name: "Rookie" };
  const loggingXpLabel = new Intl.NumberFormat().format(loggingXp);
  return <div role="dialog" aria-modal="true" className="fixed inset-0 z-[9999] bg-background"><div className="mx-auto h-full max-w-2xl overflow-y-auto px-4 pb-24 pt-[max(5.5rem,calc(env(safe-area-inset-top)+1.5rem))]">
    <div className="sticky top-0 z-10 -mx-4 flex min-h-[68px] items-center gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur"><button type="button" onClick={onBack} className="flex h-11 items-center gap-2 rounded-xl border bg-card px-3 font-bold shadow-sm"><ArrowLeft className="h-5 w-5"/><span>Back</span></button><div className="min-w-0 flex-1"><div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Athlete profile</div><div className="truncate text-lg font-black">{row.display_name}</div></div><button type="button" onClick={onClose} className="text-xs font-bold text-primary">Home</button></div>
    <div className="mt-4 flex items-center gap-4 rounded-2xl border bg-card p-4"><Avatar className="h-16 w-16"><AvatarImage src={row.avatar_url??undefined}/><AvatarFallback className="text-xl font-black">{(row.display_name||"?").slice(0,1)}</AvatarFallback></Avatar><div><div className="text-xl font-black">{row.display_name}</div><div className="font-black text-primary">#{row.rank} · {rating(row).toFixed(1)} Performance Score</div><div className="text-xs text-muted-foreground">{row.bodyweight_value?Number(row.bodyweight_value).toFixed(1)+" "+(row.bodyweight_unit??"lb"):"Bodyweight verified"} · {badges.length} achievements</div></div></div>
    <div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-2xl border bg-card p-4"><div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Performance</div><div className="mt-1 text-lg font-black text-primary">{rating(row).toFixed(1)}</div><div className="text-xs text-muted-foreground">Monthly score</div></div><div className="rounded-2xl border bg-card p-4"><div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Logging level</div><div className="mt-1 text-lg font-black">{loggingLevel.name}</div><div className="text-xs text-muted-foreground">{loggingXpLabel} XP</div></div></div>
    <div className="mt-4"><PublicAchievements badges={badges} name={row.display_name}/></div>
  </div></div>;
}

