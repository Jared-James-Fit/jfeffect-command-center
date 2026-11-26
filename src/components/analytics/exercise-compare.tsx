import { useMemo,useState } from "react";
import { Sheet,SheetContent,SheetTitle,SheetDescription } from "@/components/ui/sheet";
import { dualLoad, type Unit } from "@/lib/analytics/units";
import { comparableE1rm } from "@/lib/analytics/strength-read";
import type { LiftHistoryPoint } from "./lift-progress-card";

type Period={id:string;name:string;start:string;end:string};
const style="min-h-10 w-full rounded-lg border border-border bg-background px-2 text-xs";
const day=(p:LiftHistoryPoint)=>p.date.slice(0,10);
export function ExerciseCompare({name,points,unit,periods=[]}:{name:string;points:LiftHistoryPoint[];unit:Unit;periods?:Period[]}){
  const [open,setOpen]=useState(false),[a,setA]=useState("recent"),[b,setB]=useState("prior"),[metric,setMetric]=useState<"single"|"estimated"|"rep">("rep"),[reps,setReps]=useState(()=>points.find(p=>p.reps>0&&p.load>0)?.reps??5);
  const [as,setAs]=useState(""),[ae,setAe]=useState(""),[bs,setBs]=useState(""),[be,setBe]=useState("");
  const choices=useMemo(()=>{
    const days=points.map(day).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))).sort();
    const end=days[days.length-1];if(!end)return [];
    const back=(n:number)=>new Date(Date.parse(end)-n*86400000).toISOString().slice(0,10);
    return [{id:"recent",name:"Latest 28 days",start:back(27),end},{id:"prior",name:"Previous 28 days",start:back(55),end:back(28)},...periods];
  },[points,periods]);
  const A=a==="custom"?{start:as,end:ae}:choices.find(p=>p.id===a),B=b==="custom"?{start:bs,end:be}:choices.find(p=>p.id===b);
  const read=(range:{start:string;end:string}|undefined)=>{
    if(!range?.start||!range.end||range.start>range.end)return null;
    let best:{value:number;source:LiftHistoryPoint}|null=null;
    for(const p of points){if(day(p)<range.start||day(p)>range.end||!(p.load>0)||!(p.reps>0))continue;if(metric==="single"&&p.reps!==1||metric==="rep"&&p.reps!==reps)continue;
      const value=metric==="estimated"?comparableE1rm(p):p.load;
      if(value!=null&&(!best||value>best.value))best={value,source:p};
    }return best;
  };
  const x=open?read(A):null,y=open?read(B):null,max=Math.max(x?.value??0,y?.value??0,1);
  return <><button type="button" className="min-h-10 text-xs font-medium underline-offset-2 hover:underline" onClick={()=>setOpen(true)}>Compare exercise ›</button>
    <Sheet open={open} onOpenChange={setOpen}><SheetContent side="bottom" swipeToClose className="max-h-[85dvh] overflow-y-auto rounded-t-2xl p-4"><SheetTitle>{name} · Compare</SheetTitle><SheetDescription>Compare best performances of the same exercise in two periods.</SheetDescription>
    <select aria-label="Metric" value={metric} onChange={e=>setMetric(e.target.value as typeof metric)} className={style}><option value="rep">Same-rep best</option><option value="single">Actual single</option><option value="estimated">Comparable e1RM</option></select>
    {metric==="rep"&&<label className="text-xs">Repetitions<input className={style} type="number" min={1} max={100} value={reps} onChange={e=>setReps(Math.min(100,Math.max(1,Number(e.target.value)||1)))}/></label>}
    {[{v:a,set:setA,start:as,end:ae,ss:setAs,se:setAe},{v:b,set:setB,start:bs,end:be,ss:setBs,se:setBe}].map((q,i)=><div key={i} className="space-y-1"><label className="text-xs">Version {i===0?"A":"B"}<select className={style} value={q.v} onChange={e=>q.set(e.target.value)}>{choices.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}<option value="custom">Custom dates</option></select></label>{q.v==="custom"&&<div className="grid grid-cols-2 gap-2"><input aria-label="Start" type="date" className={style} value={q.start} onChange={e=>q.ss(e.target.value)}/><input aria-label="End" type="date" className={style} value={q.end} onChange={e=>q.se(e.target.value)}/></div>}</div>)}
    {[{r:x,p:A},{r:y,p:B}].map(({r,p},i)=><div key={i} className="space-y-1"><div className="flex justify-between text-sm"><span>{i===0?"A":"B"}</span><strong>{r?dualLoad(r.value,unit).main:"No qualifying set"}</strong></div><div className="h-2 rounded-full bg-muted"><div className={i?"h-2 rounded-full bg-muted-foreground":"h-2 rounded-full bg-primary"} style={{width:(r?.value??0)/max*100+"%"}}/></div><div className="text-xs text-muted-foreground">{p?.start} – {p?.end}{r&&" · "+dualLoad(r.value,unit).other+" · "+day(r.source)+" · "+dualLoad(r.source.load,unit).main+" × "+r.source.reps}</div></div>)}
    {x&&y&&<p className="text-sm"><strong>{x.value>=y.value?"+":"−"}{dualLoad(Math.abs(x.value-y.value),unit).main}</strong> ({((x.value-y.value)/y.value*100).toFixed(1)}%) · {metric==="estimated"?"Estimated, not achieved.":"Compare execution and effort as well as load."}</p>}
    <button type="button" className="min-h-10 rounded-lg border text-sm" onClick={()=>setOpen(false)}>Done</button></SheetContent></Sheet></>;
}
