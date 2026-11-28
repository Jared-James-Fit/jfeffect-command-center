import {useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {supabase} from "@/integrations/supabase/client";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from "@/components/ui/dialog";
type Clip={ref:string;title:string;detail:string;date?:string;weight?:{value:string;unit:"kg"|"lb"};reps?:number;rpe?:number};
export function ExistingLiftPicker({clientId,value,disabled,onPick}:{clientId:string;value:string;disabled:boolean;onPick:(clip:Clip|null)=>void}){
 const [open,setOpen]=useState(false),[search,setSearch]=useState("");
 const query=useQuery({queryKey:["prep-existing-lifts",clientId],enabled:open,queryFn:async()=>{
 const db=supabase as any;
 const [set,lift]=await Promise.all([
 db.from("pl_set_videos").select("id,exercise_name,label,created_at").eq("client_id",clientId).is("deleted_at",null).order("created_at",{ascending:false}).limit(100),
 db.from("lift_videos").select("id,exercise,load_text,reps,rpe,date_performed,created_at,status").eq("client_id",clientId).neq("status","Archived").not("video_storage_path","is",null).order("created_at",{ascending:false}).limit(100)]);
 if(set.error&&lift.error)throw Error("Couldn't load existing lifts");
 const clips:Clip[]=[...(set.data??[]).map((v:any)=>({ref:"set:"+v.id,title:v.exercise_name??v.label??"Workout video",detail:[v.label,"Uploaded "+String(v.created_at).slice(0,10)].filter(Boolean).join(" · ")})),
 ...(lift.data??[]).map((v:any)=>{const m=String(v.load_text??"").match(/^(\d+(?:\.\d+)?)\s*(kg|lb)s?$/i);return {ref:"lift:"+v.id,title:v.exercise??"Lift video",detail:[v.load_text,v.date_performed].filter(Boolean).join(" · "),date:v.date_performed??undefined,weight:m?{value:m[1],unit:m[2].toLowerCase() as "kg"|"lb"}:undefined,reps:v.reps??undefined,rpe:v.rpe??undefined};})];
 return {clips,partial:!!set.error||!!lift.error};
 }});
 return <div className="space-y-1">{value&&<p className="text-xs text-muted-foreground">Existing lift linked · no duplicate upload</p>}{!disabled&&<div className="flex gap-2"><Button size="sm" variant="outline" type="button" onClick={()=>setOpen(true)}>{value?"Change existing lift":"Use existing lift"}</Button>{value&&<Button size="sm" variant="ghost" type="button" onClick={()=>onPick(null)}>Unlink</Button>}</div>}
 <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85svh] overflow-y-auto"><DialogHeader><DialogTitle>Use an existing lift</DialogTitle><DialogDescription>Choose footage already saved to your account. No re-upload needed.</DialogDescription></DialogHeader><Input placeholder="Search exercises" value={search} onChange={e=>setSearch(e.target.value)}/>{query.isPending?<p>Loading lifts…</p>:query.isError?<Button onClick={()=>void query.refetch()}>Retry</Button>:<>{query.data?.partial&&<p className="text-xs text-muted-foreground">Some sources are unavailable.</p>}{query.data?.clips.filter(c=>(c.title+" "+c.detail).toLowerCase().includes(search.toLowerCase())).map(c=><button type="button" key={c.ref} className="block w-full rounded-lg border p-3 text-left" onClick={()=>{onPick(c);setOpen(false);}}><p className="font-medium">{c.title}</p><p className="text-xs text-muted-foreground">{c.detail}</p></button>)}{!query.data?.clips.length&&<p className="text-sm text-muted-foreground">No saved lifts available. Upload a video instead.</p>}</>}</DialogContent></Dialog></div>;
}
