import {useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {useServerFn} from "@tanstack/react-start";
import {Button} from "@/components/ui/button";
import {getCompetitionPrepEvidenceFn,getCompetitionPrepVideoFn} from "@/lib/competition/handling.functions";
import {toast} from "sonner";
export function PrepReferences({competitionId}:{competitionId:string}){
 const [open,setOpen]=useState(false);
 const [playing,setPlaying]=useState<{id:string;url:string}|null>(null);
 const read=useServerFn(getCompetitionPrepEvidenceFn),video=useServerFn(getCompetitionPrepVideoFn);
 const q=useQuery({queryKey:["competition-prep-evidence",competitionId],enabled:open,staleTime:30_000,queryFn:()=>read({data:{competitionId}})});
 async function play(id:string){try{const v=await video({data:{competitionId,fileId:id}});setPlaying({id,url:v.url});}catch(e){toast.error(e instanceof Error?e.message:"Video unavailable");}}
 return <div className="rounded-xl border border-border"><Button variant="ghost" className="w-full justify-between" onClick={()=>{setOpen(!open);setPlaying(null);}}>Prep references <span>{open?"−":"+"}</span></Button>{open&&<div className="space-y-3 px-3 pb-3">
 {q.isPending?<p className="text-sm text-muted-foreground">Loading…</p>:q.isError?<Button variant="outline" size="sm" onClick={()=>void q.refetch()}>Retry references</Button>:<>
 {!q.data?.lifts.length&&!q.data?.cues.length&&<p className="text-sm text-muted-foreground">No submitted prep references linked to this meet.</p>}
 {q.data?.lifts.map((l:any)=><div key={l.id} className="space-y-1 border-b border-border pb-2"><p className="text-sm font-medium">{l.exercise} · {l.title}</p><p className="text-sm text-muted-foreground">{[l.fields.weight,l.fields.reps&&l.fields.reps+" reps",l.fields.rpe&&"RPE "+l.fields.rpe,l.fields.date].filter(Boolean).join(" · ")}</p>{l.fields.notes&&<p className="text-sm whitespace-pre-wrap">{l.fields.notes}</p>}{l.videoIds.map((id:string,i:number)=><div key={id}>{playing?.id===id?<video controls playsInline src={playing.url} className="w-full max-h-72 rounded-lg"/>:<Button size="sm" variant="outline" onClick={()=>void play(id)}>Play video {l.videoIds.length>1?i+1:""}</Button>}</div>)}</div>)}
 {!!q.data?.cues.length&&<details><summary className="text-sm font-medium">Athlete's cue profile · original answers</summary>{q.data.cues.map((c:any)=><div key={c.id} className="mt-2"><p className="text-xs text-muted-foreground">{c.label}</p><p className="text-sm whitespace-pre-wrap">{c.text}</p></div>)}</details>}
 </>}
 </div>}</div>;
}
