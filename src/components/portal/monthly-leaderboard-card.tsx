import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Trophy, Medal, ChevronRight, Scale } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { AthleteLevelCard } from "@/components/portal/athlete-level-card";

type Row = { client_id:string; display_name:string; avatar_url:string|null; monthly_xp:number; rank:number|null; is_me:boolean; qualified:boolean; bodyweight_value:number|null; bodyweight_unit:string|null };

export function MonthlyLeaderboardCard({ clientId }: { clientId:string }) {
  const [open, setOpen] = useState(false);
  const { data = [], isPending } = useQuery({
    queryKey:["athlete-rankings-monthly"],
    staleTime:60_000,
    queryFn:async()=>{ const {data,error}=await (supabase as any).rpc("get_monthly_athlete_rankings",{_limit:15}); if(error) throw error; return (data??[]) as Row[]; }
  });
  const ranked=data.filter(r=>r.qualified && r.rank!=null).sort((a,b)=>Number(a.rank)-Number(b.rank));
  const me=data.find(r=>r.is_me);
  const top=ranked.slice(0,3);
  return <>
    <Card className="overflow-hidden">
      <button type="button" onClick={()=>setOpen(true)} className="w-full p-4 text-left transition-colors hover:bg-muted/30 active:bg-muted/50">
        <div className="flex items-start justify-between gap-3">
          <div><div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground"><Trophy className="h-3.5 w-3.5 text-primary"/> {format(new Date(),"MMMM")} Leaderboard</div>
          <div className="mt-1 text-xl font-black">JF Performance Top 15</div></div>
          <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-primary"/>
        </div>
        {isPending ? <div className="mt-4 h-20 animate-pulse rounded-xl bg-muted"/> : me?.qualified ? <>
          <div className="mt-4 flex items-end justify-between rounded-xl border bg-primary/5 p-3">
            <div><div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Your rank</div><div className="text-3xl font-black text-primary">#{me.rank}</div></div>
            <div className="text-right"><div className="text-xl font-black">{Number(me.monthly_xp).toLocaleString()} XP</div><div className="text-[10px] text-muted-foreground">of 1,000 monthly XP</div></div>
          </div>
          <Progress value={Math.min(100,Number(me.monthly_xp)/10)} className="mt-2 h-2"/>
        </> : <div className="mt-4 flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950"><Scale className="h-5 w-5 shrink-0"/><div><div className="text-xs font-black">Log bodyweight to enter</div><div className="text-[10px]">Add a bodyweight in the app to enter. Your latest logged weight is always used.</div></div></div>}
        {top.length>0 && <div className="mt-4 grid grid-cols-3 gap-2">{top.map(r=><div key={r.client_id} className="min-w-0 rounded-xl border bg-muted/20 p-2 text-center"><div className="mx-auto mb-1 flex items-center justify-center gap-1 text-[10px] font-black"><Medal className="h-3 w-3"/>#{r.rank}</div><Avatar className="mx-auto h-8 w-8"><AvatarImage src={r.avatar_url??undefined}/><AvatarFallback>{r.display_name.slice(0,1)}</AvatarFallback></Avatar><div className="mt-1 truncate text-[10px] font-bold">{r.display_name}</div><div className="text-[9px] font-black text-primary">{r.monthly_xp} XP</div></div>)}</div>}
        <div className="mt-3 text-center text-xs font-black text-primary">VIEW TOP 15 ›</div>
      </button>
    </Card>
    {open && <div className="hidden"><AthleteLevelCard clientId={clientId} defaultView="rankings"/></div>}
    {open && <LeaderboardOverlay clientId={clientId} onClose={()=>setOpen(false)}/>}
  </>;
}

function LeaderboardOverlay({clientId,onClose}:{clientId:string;onClose:()=>void}) {
  return <div className="fixed inset-0 z-[70] bg-background"><div className="mx-auto h-full max-w-2xl overflow-y-auto px-4 pb-safe-bottom pt-safe-top"><button onClick={onClose} className="mb-2 mt-3 min-h-11 rounded-xl border bg-card px-4 text-sm font-bold">← Back</button><AthleteLevelCard clientId={clientId} defaultView="rankings"/></div></div>;
}
