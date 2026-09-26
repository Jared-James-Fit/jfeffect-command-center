import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Trophy } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/athlete-records")({ component: AthleteRecordsAdmin });

const empty = { client_id:"", athlete_name:"", sex:"male", bodyweight_kg:"", squat_kg:"", bench_kg:"", deadlift_kg:"", points:"", points_system:"DOTS", meet_name:"", meet_location:"", meet_date:"", competition_level:"local", notes:"" };

function AthleteRecordsAdmin(){
 const qc=useQueryClient(); const [form,setForm]=useState<any>(empty); const [saving,setSaving]=useState(false);
 const {data:clients=[]}=useQuery({queryKey:["athlete-record-clients"],queryFn:async()=>((await supabase.from("clients").select("id,full_name").order("full_name")).data??[]) as any[]});
 const {data:rows=[]}=useQuery({queryKey:["athlete-powerlifting-results-admin"],queryFn:async()=>{const {data,error}=await (supabase as any).from("athlete_powerlifting_results").select("*").order("meet_date",{ascending:false});if(error)throw error;return data??[]}});
 const set=(k:string,v:any)=>setForm((f:any)=>({...f,[k]:v}));
 const save=async()=>{if(!form.athlete_name||!form.bodyweight_kg)return toast.error("Athlete name and bodyweight are required");setSaving(true);try{const payload={...form,client_id:form.client_id||null,bodyweight_kg:Number(form.bodyweight_kg),squat_kg:Number(form.squat_kg||0),bench_kg:Number(form.bench_kg||0),deadlift_kg:Number(form.deadlift_kg||0),points:form.points?Number(form.points):null,meet_date:form.meet_date||null};const {error}=await (supabase as any).from("athlete_powerlifting_results").insert(payload);if(error)throw error;toast.success("Powerlifting result added");setForm(empty);qc.invalidateQueries({queryKey:["athlete-powerlifting-results-admin"]});qc.invalidateQueries({queryKey:["powerlifting-rankings"]})}catch(e:any){toast.error(e.message)}finally{setSaving(false)}};
 const del=async(id:string)=>{const {error}=await (supabase as any).from("athlete_powerlifting_results").delete().eq("id",id);if(error)return toast.error(error.message);toast.success("Result deleted");qc.invalidateQueries({queryKey:["athlete-powerlifting-results-admin"]});};
 return <><PageHeader title="Athlete Records" subtitle="Permanent JF powerlifting records & competition résumé"/><div className="space-y-4 p-3 sm:p-4 md:p-6">
 <Card className="p-4"><div className="mb-4"><div className="font-black">Add powerlifting result</div><div className="text-xs text-muted-foreground">Add current or retired JF athletes. Results remain in the all-time records even if they are no longer active clients.</div></div>
 <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
 <Field label="Athlete name"><Input value={form.athlete_name} onChange={e=>set("athlete_name",e.target.value)} placeholder="Full name"/></Field>
 <Field label="Link client (optional)"><Select value={form.client_id||"none"} onValueChange={v=>{set("client_id",v==="none"?"":v);const c=clients.find(x=>x.id===v);if(c)set("athlete_name",c.full_name)}}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="none">Historical / retired athlete</SelectItem>{clients.map(c=><SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}</SelectContent></Select></Field>
 <Field label="Sex"><Select value={form.sex} onValueChange={v=>set("sex",v)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="male">Male</SelectItem><SelectItem value="female">Female</SelectItem></SelectContent></Select></Field>
 <Field label="Bodyweight (kg)"><Input type="number" step=".01" value={form.bodyweight_kg} onChange={e=>set("bodyweight_kg",e.target.value)}/></Field>
 <Field label="Squat (kg)"><Input type="number" step=".5" value={form.squat_kg} onChange={e=>set("squat_kg",e.target.value)}/></Field>
 <Field label="Bench (kg)"><Input type="number" step=".5" value={form.bench_kg} onChange={e=>set("bench_kg",e.target.value)}/></Field>
 <Field label="Deadlift (kg)"><Input type="number" step=".5" value={form.deadlift_kg} onChange={e=>set("deadlift_kg",e.target.value)}/></Field>
 <Field label="DOTS / GL points"><Input type="number" step=".01" value={form.points} onChange={e=>set("points",e.target.value)}/></Field>
 <Field label="Points system"><Select value={form.points_system} onValueChange={v=>set("points_system",v)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="DOTS">DOTS</SelectItem><SelectItem value="GL">GL Points</SelectItem></SelectContent></Select></Field>
 <Field label="Meet name"><Input value={form.meet_name} onChange={e=>set("meet_name",e.target.value)}/></Field>
 <Field label="Meet location"><Input value={form.meet_location} onChange={e=>set("meet_location",e.target.value)} placeholder="Winnipeg, MB"/></Field>
 <Field label="Meet date"><Input type="date" value={form.meet_date} onChange={e=>set("meet_date",e.target.value)}/></Field>
 <Field label="Competition level"><Select value={form.competition_level} onValueChange={v=>set("competition_level",v)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{["local","provincial","regional","national","international"].map(x=><SelectItem key={x} value={x}>{x[0].toUpperCase()+x.slice(1)}</SelectItem>)}</SelectContent></Select></Field>
 </div><Button className="mt-4" disabled={saving} onClick={save}><Trophy className="mr-2 h-4 w-4"/>{saving?"Saving…":"Add result"}</Button></Card>
 <Card className="overflow-hidden"><div className="border-b p-4"><div className="font-black">Powerlifting history</div><div className="text-xs text-muted-foreground">{rows.length} saved result{rows.length===1?"":"s"}</div></div>
 <div className="divide-y">{rows.map((r:any)=><div key={r.id} className="flex items-center gap-3 p-3"><div className="min-w-0 flex-1"><div className="truncate font-bold">{r.athlete_name}</div><div className="text-xs text-muted-foreground">{r.squat_kg} / {r.bench_kg} / {r.deadlift_kg} = {r.total_kg} kg · {r.points??"—"} {r.points_system}</div><div className="text-[11px] text-muted-foreground">{r.meet_name||"Meet"}{r.meet_location?` · ${r.meet_location}`:""}{r.meet_date?` · ${new Date(r.meet_date+"T00:00:00").getFullYear()}`:""}</div></div><Button variant="ghost" size="icon" onClick={()=>del(r.id)} aria-label="Delete result"><Trash2 className="h-4 w-4"/></Button></div>)}</div></Card>
 </div></>
}
function Field({label,children}:{label:string;children:React.ReactNode}){return <div className="space-y-1.5"><Label className="text-xs">{label}</Label>{children}</div>}
