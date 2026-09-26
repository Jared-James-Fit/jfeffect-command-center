import { useQuery,useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const blank={id:"",client_id:"",athlete_name:"",sex:"male",openpowerlifting_url:"",jf_start_date:"",jf_end_date:"",auto_sync:false};
export function PowerliftingAthleteProfiles({clients=[]}:{clients:any[]}){
 const qc=useQueryClient(); const [p,setP]=useState<any>(blank);
 const {data:athletes=[]}=useQuery({queryKey:["powerlifting-athletes-admin"],queryFn:async()=>{const {data,error}=await (supabase as any).from("powerlifting_athletes").select("*").order("athlete_name");if(error)throw error;return data??[]}});
 const save=async()=>{if(!p.athlete_name)return toast.error("Athlete name is required");const payload={...p,id:p.id||undefined,client_id:p.client_id||null,jf_start_date:p.jf_start_date||null,jf_end_date:p.jf_end_date||null};const {error}=await (supabase as any).from("powerlifting_athletes").upsert(payload);if(error)return toast.error(error.message);toast.success("Athlete profile saved");setP(blank);qc.invalidateQueries({queryKey:["powerlifting-athletes-admin"]})};
 return <Card className="p-4"><div className="mb-4"><div className="font-black">Athlete profiles & JF eligibility</div><div className="text-xs text-muted-foreground">One identity per athlete. Meets outside the JF start/cutoff window stay in history but do not count toward JF records.</div></div>
 <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
 <F l="Linked client"><Select value={p.client_id||"none"} onValueChange={v=>{const c=clients.find(x=>x.id===v);setP({...p,client_id:v==="none"?"":v,athlete_name:c?.full_name||p.athlete_name})}}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="none">Historical / retired</SelectItem>{clients.map(c=><SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}</SelectContent></Select></F>
 <F l="Athlete name"><Input value={p.athlete_name} onChange={e=>setP({...p,athlete_name:e.target.value})}/></F>
 <F l="Sex"><Select value={p.sex} onValueChange={v=>setP({...p,sex:v})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="male">Male</SelectItem><SelectItem value="female">Female</SelectItem></SelectContent></Select></F>
 <F l="OpenPowerlifting URL"><Input value={p.openpowerlifting_url||""} onChange={e=>setP({...p,openpowerlifting_url:e.target.value})} placeholder="https://openpowerlifting.org/u/..."/></F>
 <F l="JF start"><Input type="date" value={p.jf_start_date||""} onChange={e=>setP({...p,jf_start_date:e.target.value})}/></F>
 <F l="JF cutoff"><Input type="date" value={p.jf_end_date||""} onChange={e=>setP({...p,jf_end_date:e.target.value})}/></F>
 </div><Button className="mt-4" onClick={save}>Save athlete profile</Button>
 <div className="mt-4 divide-y rounded-xl border">{athletes.map((a:any)=><button type="button" key={a.id} onClick={()=>setP({...a,jf_start_date:a.jf_start_date||"",jf_end_date:a.jf_end_date||"",openpowerlifting_url:a.openpowerlifting_url||""})} className="flex w-full items-center justify-between p-3 text-left"><span><b className="block text-sm">{a.athlete_name}</b><span className="text-[11px] text-muted-foreground">{a.jf_start_date||"No start"} → {a.jf_end_date||"Current"}{a.openpowerlifting_url?" · OPL linked":""}</span></span><span className="text-xs text-primary">Edit</span></button>)}</div></Card>
}
function F({l,children}:{l:string;children:any}){return <div className="space-y-1.5"><Label className="text-xs">{l}</Label>{children}</div>}
