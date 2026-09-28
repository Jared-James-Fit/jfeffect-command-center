// Production deploy marker: 2026-09-28 performance-rating rebuild v2
import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Trophy, Medal, ChevronRight, Scale, ArrowLeft, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { combinedBodyweightQueryKey, getCombinedBodyweightSeries } from "@/lib/bodyweight";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PublicAchievements } from "@/components/portal/achievements-card";
import { usePublicAchievements } from "@/lib/athlete-achievements";

type Row = { client_id:string; display_name:string; avatar_url:string|null; monthly_xp:number; rank:number|null; is_me:boolean; qualified:boolean; bodyweight_value:number|null; bodyweight_unit:string|null; strength_score?:number; workouts_completed?:number; fully_logged?:number };\nconst rating=(r?:Row|null)=>Number(r?.monthly_xp??0)/10;

export function MonthlyLeaderboardCard({ clientId, userId }: { clientId:string; userId:string }) {
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
  const ranked=data.filter(r=>r.qualified && r.rank!=null).sort((a,b)=>Number(a.rank)-Number(b.rank));
  const me=data.find(r=>r.client_id===clientId) ?? data.find(r=>r.is_me);
  const { data: localBodyweights = [] } = useQuery({ queryKey: combinedBodyweightQueryKey(userId), enabled: !!userId, queryFn: () => getCombinedBodyweightSeries(userId, 200) });
  const latestLocalWeight = localBodyweights.length ? localBodyweights[localBodyweights.length - 1] : null;
  const locallyQualified = !!latestLocalWeight;
  const top=ranked.slice(0,3);
  return <>
    <Card className="overflow-hidden">
      <button type="button" onClick={()=>setOpen(true)} className="w-full p-4 text-left transition-colors hover:bg-muted/30 active:bg-muted/50">
        <div className="flex items-start justify-between gap-3">
          <div><div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground"><Trophy className="h-3.5 w-3.5 text-primary"/> {format(new Date(),"MMMM")} Performance League</div>
          <div className="mt-1 text-xl font-black">JF Performance League</div><div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Top 10</div></div>
          <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-primary"/>
        </div>
        {isPending ? <div className="mt-4 h-20 animate-pulse rounded-xl bg-muted"/> : me?.qualified ? <>
          <div className="mt-4 flex items-end justify-between rounded-xl border bg-primary/5 p-3">
            <div><div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">League rank</div><div className="text-3xl font-black text-primary">{me?.qualified && me.rank ? `#${me.rank}` : "ENTERED"}</div></div>
            <div className="text-right"><div className="text-xl font-black">{rating(me).toFixed(1)}</div><div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Performance Rating</div></div>
          </div>
        </> : <div className="mt-4 flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950"><Scale className="h-5 w-5 shrink-0"/><div><div className="text-xs font-black">Log bodyweight to enter</div><div className="text-[10px]">Add a bodyweight in the app to enter. Your latest logged weight is always used.</div></div></div>}
        {top.length>0 && <div className="mt-4 grid grid-cols-3 gap-2">{top.map(r=><div key={r.client_id} className="min-w-0 rounded-xl border bg-muted/20 p-2 text-center"><div className="mx-auto mb-1 flex items-center justify-center gap-1 text-[10px] font-black"><Medal className="h-3 w-3"/>#{r.rank}</div><Avatar className="mx-auto h-8 w-8"><AvatarImage src={r.avatar_url??undefined}/><AvatarFallback>{r.display_name.slice(0,1)}</AvatarFallback></Avatar><div className="mt-1 truncate text-[10px] font-bold">{r.display_name}</div><div className="text-[9px] font-black text-primary">{rating(r).toFixed(1)}</div></div>)}</div>}
        <div className="mt-3 text-center text-xs font-black text-primary">VIEW STANDINGS ›</div>
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
        <div className="mb-2 flex items-center gap-2 font-black text-foreground"><Info className="h-4 w-4 text-primary"/>How you rank</div>\n        <div><b>Your Performance Rating is scored out of 100:</b> 50% relative performance, 35% training execution, 10% training quality, and 5% bodyweight tracking.</div>\n        <div className="mt-2"><b>Relative performance matters most.</b> Get stronger relative to your bodyweight, complete your programmed training, and log your work. Highest Performance Rating takes #1.</div>
      </div>
      {loading ? <div className="py-10 text-center text-sm text-muted-foreground">Loading leaderboard…</div> :
       <div className="mt-4 space-y-2">{ranked.map(r=><button type="button" onClick={()=>setSelected(r)} key={r.client_id} className={"flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors active:bg-muted/60 "+(r.is_me?"bg-primary/5 ring-1 ring-primary/30":"bg-card")}>
         <div className="w-9 text-center text-lg font-black text-primary">#{r.rank}</div>
         <Avatar className="h-11 w-11"><AvatarImage src={r.avatar_url??undefined}/><AvatarFallback>{(r.display_name||"?").slice(0,1)}</AvatarFallback></Avatar>
         <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><div className="truncate font-bold">{r.display_name}{r.is_me?" (You)":""}</div><ChevronRight className="h-4 w-4 shrink-0 text-primary"/></div><div className="text-[11px] text-muted-foreground">{r.bodyweight_value?Number(r.bodyweight_value).toFixed(1)+" "+(r.bodyweight_unit??"lb"):"Bodyweight verified"} · Tap for profile</div></div>
         <div className="text-right"><div className="text-lg font-black text-primary">{rating(r).toFixed(1)}</div><div className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Rating</div></div>
       </button>)}</div>}
      <div className="mt-3 text-center text-[11px] text-muted-foreground">{isAdmin ? "Admin view · Full ranked list" : "Top 10 · Tap an athlete to view their profile and achievements."}</div>
    </div>
  </div>;
}

function AthleteProfileOverlay({row,onBack,onClose}:{row:Row;onBack:()=>void;onClose:()=>void}) {
  const {data:badges=[]}=usePublicAchievements(row.client_id);
  return <div role="dialog" aria-modal="true" className="fixed inset-0 z-[9999] bg-background"><div className="mx-auto h-full max-w-2xl overflow-y-auto px-4 pb-24 pt-[max(5.5rem,calc(env(safe-area-inset-top)+1.5rem))]">
    <div className="sticky top-0 z-10 -mx-4 flex min-h-[68px] items-center gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur"><button type="button" onClick={onBack} className="flex h-11 items-center gap-2 rounded-xl border bg-card px-3 font-bold shadow-sm"><ArrowLeft className="h-5 w-5"/><span>Back</span></button><div className="min-w-0 flex-1"><div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Athlete profile</div><div className="truncate text-lg font-black">{row.display_name}</div></div><button type="button" onClick={onClose} className="text-xs font-bold text-primary">Home</button></div>
    <div className="mt-4 flex items-center gap-4 rounded-2xl border bg-card p-4"><Avatar className="h-16 w-16"><AvatarImage src={row.avatar_url??undefined}/><AvatarFallback className="text-xl font-black">{(row.display_name||"?").slice(0,1)}</AvatarFallback></Avatar><div><div className="text-xl font-black">{row.display_name}</div><div className="font-black text-primary">#{row.rank} · {rating(row).toFixed(1)} Performance Rating</div><div className="text-xs text-muted-foreground">{row.bodyweight_value?Number(row.bodyweight_value).toFixed(1)+" "+(row.bodyweight_unit??"lb"):"Bodyweight verified"} · {badges.length} achievements</div></div></div>
    <div className="mt-4"><PublicAchievements badges={badges} name={row.display_name}/></div>
  </div></div>;
}

