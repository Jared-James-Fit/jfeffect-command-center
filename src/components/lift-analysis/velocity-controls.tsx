import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { announceChanged } from "@/lib/lift-analysis/store";
import { setupQuality } from "@/lib/lift-analysis/quality";
import type { LiftAnalysis } from "@/lib/lift-analysis/analyze";
import { olympicExercise } from "@/lib/lift-analysis/exercise";

const db = supabase as any;
const STATUS: Record<string,string> = { queued:"Waiting to read", running:"Reading on an open device", done:"Read complete", needs_calibration:"Needs calibration", needs_review:"Needs a look", failed:"Read stopped", cancelled:"Video removed", skipped:"Automatic reading off" };

export function VelocityControls({ videoId, analysis, exerciseName, onCalibrate }: { videoId:string; analysis:LiftAnalysis|null; exerciseName:string; onCalibrate:()=>void }) {
  const qc=useQueryClient();
  const [historyOpen,setHistoryOpen]=useState(false);
  const [edit,setEdit]=useState(false);
  const [value,setValue]=useState("");
  const [reason,setReason]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const job=useQuery({ queryKey:["velocity-job",videoId], refetchInterval:5000, queryFn:async()=>{ const r=await db.from("set_velocity_jobs").select("*").eq("set_video_id",videoId).maybeSingle(); if(r.error) throw r.error; return r.data; } });
  const history=useQuery({ queryKey:["velocity-history",videoId],enabled:historyOpen,queryFn:async()=>{ const r=await db.from("set_velocity_history").select("id,happened_at,operation,reason,after_value").eq("subject_id",videoId).eq("subject_kind","analysis").order("happened_at",{ascending:false}).limit(30); if(r.error) throw r.error; return r.data as any[]; } });
  const meta=useQuery({queryKey:["velocity-control-meta",videoId],queryFn:async()=>{
    const a=await db.from("pl_set_video_analyses").select("excluded").eq("set_video_id",videoId).maybeSingle(); if(a.error)throw a.error;
    const v=await db.from("pl_set_videos").select("result_id").eq("id",videoId).maybeSingle(); if(v.error)throw v.error;
    const row=v.data?.result_id ? await db.from("pl_row_results").select("velocity_excluded,velocity_selected_video_id").eq("id",v.data.result_id).maybeSingle():null; if(row?.error)throw row.error;
    return {excluded:a.data?.excluded??false,set:row?.data};
  }});
  const run=async(name:string,args:Record<string,unknown>)=>{
    if(busy)return; setBusy(true);setError("");
    try {const r=await db.rpc(name,args);if(r.error)throw r.error;announceChanged(videoId);await qc.invalidateQueries({queryKey:["velocity-job"]});await qc.invalidateQueries({queryKey:["velocity-control-meta"]});await qc.invalidateQueries({queryKey:["velocity-history"]});setEdit(false);}
    catch(e){setError(e instanceof Error?e.message:"This change could not be saved.");} finally{setBusy(false);}
  };
  const control=(action:string,more:Record<string,unknown>={})=>run("velocity_control",{_video:videoId,_action:action,...more});
  const quality=analysis?setupQuality(analysis):null;
  const olympic=olympicExercise(exerciseName);
  return <section className="mb-4 space-y-2 border-b border-border pb-3" aria-label="Velocity controls">
    <p className="text-sm font-medium" role="status">{job.error?"Could not read job status":STATUS[job.data?.status]??"Not queued"}{job.data?.attempts>0?` · attempt ${job.data.attempts} of 3`:""}</p>
    {job.data?.error && <p className="text-xs text-muted-foreground">{job.data.error}</p>}
    {olympic && <p className="text-xs text-muted-foreground">Olympic pull, catch and jerk phases are not validated here. Automatic speed logging is off.</p>}
    {quality && <details className="text-xs text-muted-foreground"><summary>Setup {quality.score}/100 · not an accuracy probability</summary><ul className="mt-1">{quality.parts.map(p=><li key={p.name}>{p.name}: {p.points}/{p.max}</li>)}</ul></details>}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={onCalibrate}>Calibrate / rerun</Button>
      <Button size="sm" variant="ghost" disabled={busy||olympic} onClick={()=>void run("velocity_job_retry",{_video:videoId,_enabled:!job.data?.enabled})}>{job.data?.enabled?"Turn off auto read":"Enable auto read"}</Button>
      {job.data?.status==="failed" && <Button size="sm" variant="outline" disabled={busy||olympic} onClick={()=>void run("velocity_job_retry",{_video:videoId,_enabled:true})}>Try again</Button>}
      <Button size="sm" variant="ghost" disabled={busy||!analysis} onClick={()=>void control(meta.data?.excluded?"include":"exclude",{_reason:meta.data?.excluded?"Included after review":"Flagged inaccurate"})}>{meta.data?.excluded?"Include this read":"Flag inaccurate / exclude"}</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={()=>setEdit(!edit)}>Edit set speed</Button>
      <Button size="sm" variant="ghost" disabled={busy||!analysis} onClick={()=>void control("select")}>{meta.data?.set?.velocity_selected_video_id===videoId?"Selected clip":"Use this clip for the set"}</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={()=>void control(meta.data?.set?.velocity_excluded?"include_set":"exclude_set")}>{meta.data?.set?.velocity_excluded?"Include set in speed analytics":"Exclude set from speed analytics"}</Button>
      <Button size="sm" variant="ghost" onClick={()=>setHistoryOpen(!historyOpen)}>Revision history</Button>
    </div>
    {edit && <div className="space-y-2"><Input value={value} onChange={e=>setValue(e.target.value)} inputMode="decimal" placeholder="Speed in m/s" aria-label="Corrected set speed"/><Input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Why it changed" aria-label="Velocity correction reason"/><Button size="sm" variant="outline" disabled={busy||!reason.trim()||!(Number(value)>0&&Number(value)<=3.5)} onClick={()=>void control("edit",{_value:Number(value),_reason:reason})}>Save correction</Button></div>}
    {historyOpen && <div className="space-y-1">{history.error?<p role="alert">History could not load.</p>:history.isPending?<p role="status">Loading history…</p>:history.data?.map(h=><div key={h.id} className="flex items-center justify-between gap-2 text-xs"><span>{new Date(h.happened_at).toLocaleString()} · {h.reason??h.operation}</span>{Array.isArray(h.after_value?.result?.reps)&&<Button size="sm" variant="ghost" disabled={busy} onClick={()=>void control("restore",{_history:h.id,_reason:"Restored historical read"})}>Restore</Button>}</div>)}</div>}
    {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
  </section>;
}