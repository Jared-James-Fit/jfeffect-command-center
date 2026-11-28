import {useState} from "react";
import {useQuery,useMutation,useQueryClient} from "@tanstack/react-query";
import {useServerFn} from "@tanstack/react-start";
import {Button} from "@/components/ui/button";
import {getCompetitionPrepEvidenceFn,getCompetitionPrepVideoFn,reviewCompetitionPrepLiftFn} from "@/lib/competition/handling.functions";
import {toast} from "sonner";
import {LiftVideoPlayer} from "@/components/lift-video-player";
import {Input} from "@/components/ui/input";
import {Textarea} from "@/components/ui/textarea";
import {Pin,Check} from "lucide-react";
export function PrepReferences({competitionId}:{competitionId:string}){
 const [open,setOpen]=useState(false);
 const [playing,setPlaying]=useState<{id:string;url:string}|null>(null);
 const read=useServerFn(getCompetitionPrepEvidenceFn),video=useServerFn(getCompetitionPrepVideoFn),review=useServerFn(reviewCompetitionPrepLiftFn);
 const qc=useQueryClient();
 const save=useMutation({mutationFn:(data:{submissionId:string;itemId:string;fingerprint?:string;pinned?:boolean;review?:{rpe:number|null;notes:string}})=>review({data:{competitionId,...data}}),onSuccess:()=>void qc.invalidateQueries({queryKey:["competition-prep-evidence",competitionId]}),onError:(e)=>toast.error(e instanceof Error?e.message:"Couldn’t save review")});
 const q=useQuery({queryKey:["competition-prep-evidence",competitionId],enabled:open,staleTime:30_000,queryFn:()=>read({data:{competitionId}})});
 async function play(id:string){try{const v=await video({data:{competitionId,fileId:id}});setPlaying({id,url:v.url});}catch(e){toast.error(e instanceof Error?e.message:"Video unavailable");}}
 return <div className="rounded-xl border border-border"><Button variant="ghost" className="w-full justify-between" onClick={()=>{setOpen(!open);setPlaying(null);}}>Prep references <span>{open?"−":"+"}</span></Button>{open&&<div className="space-y-3 px-3 pb-3">
 {q.isPending?<p className="text-sm text-muted-foreground">Loading…</p>:q.isError?<Button variant="outline" size="sm" onClick={()=>void q.refetch()}>Retry references</Button>:<>
 {!q.data?.lifts.length&&!q.data?.cues.length&&<p className="text-sm text-muted-foreground">No submitted prep references linked to this meet.</p>}
 {q.data?.lifts.map((l:any)=><div key={l.id} className="space-y-1 border-b border-border pb-2"><p className="text-sm font-medium">{l.exercise} · {l.title}{l.reviewed?" · Reviewed":l.updatedSinceReview?" · Updated":""}</p><p className="text-sm text-muted-foreground">{[l.fields.weight,l.fields.reps&&l.fields.reps+" reps",l.fields.rpe&&"RPE "+l.fields.rpe,l.fields.date].filter(Boolean).join(" · ")}</p>{l.fields.notes&&<p className="text-sm whitespace-pre-wrap">{l.fields.notes}</p>}{l.videoIds.map((id:string,i:number)=><div key={id}>{playing?.id===id?<LiftVideoPlayer src={playing.url} title={l.title}/>:<Button size="sm" variant="outline" onClick={()=>void play(id)}>Play video {l.videoIds.length>1?i+1:""}</Button>}</div>)}<div className="flex items-center gap-2"><Button size="sm" variant={l.pinned?"default":"ghost"} disabled={save.isPending} onClick={()=>save.mutate({submissionId:l.submissionId,itemId:l.itemId,pinned:!l.pinned})}><Pin className="mr-1 h-3.5 w-3.5"/>{l.pinned?"Pinned":"Pin for Game Day"}</Button></div><LiftAssessment key={l.id+":"+l.fingerprint} lift={l} busy={save.isPending} onReview={(rpe,notes)=>save.mutate({submissionId:l.submissionId,itemId:l.itemId,fingerprint:l.fingerprint,review:{rpe,notes}})}/></div>)}
 {!!q.data?.cues.length&&<details><summary className="text-sm font-medium">Athlete's cue profile · original answers</summary>{q.data.cues.map((c:any)=><div key={c.id} className="mt-2"><p className="text-xs text-muted-foreground">{c.label}</p><p className="text-sm whitespace-pre-wrap">{c.text}</p></div>)}</details>}
 </>}
 </div>}</div>;
}

function LiftAssessment({lift,busy,onReview}:{lift:any;busy:boolean;onReview:(rpe:number|null,notes:string)=>void}){
 const [rpe,setRpe]=useState(lift.coachRpe==null?"":String(lift.coachRpe)),[notes,setNotes]=useState(lift.coachNotes??"");
 const n=rpe.trim()===""?null:Number(rpe),valid=n===null||(Number.isFinite(n)&&n>=0&&n<=10);
 return <details><summary className="cursor-pointer text-sm font-medium">{lift.reviewed?"Coach assessment":lift.updatedSinceReview?"Review updated lift":"Review lift"}</summary><div className="mt-2 space-y-2"><label className="block text-xs">Coach RPE (optional)<Input inputMode="decimal" value={rpe} onChange={e=>setRpe(e.target.value)} placeholder="—"/></label><Textarea rows={2} maxLength={2000} placeholder="Technique, competition validity, cues…" value={notes} onChange={e=>setNotes(e.target.value)}/><Button size="sm" disabled={busy||!valid} onClick={()=>onReview(n,notes)}><Check className="mr-1 h-4 w-4"/>Save review</Button></div></details>;
}
