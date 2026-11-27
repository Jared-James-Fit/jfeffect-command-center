import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClientNameLink } from "@/components/clients/client-name-link";
import { listStaffFormRequirements, getStaffFormAcceptanceEvidence, type StaffFormRequirement } from "@/lib/staff-form-requirements.functions";
import { ChevronRight, CheckCircle2 } from "lucide-react";

export function useStaffFormRequirements(clientId?: string) {
  const {user,accountRole}=useAuth();
  const read=useServerFn(listStaffFormRequirements);
  return useQuery({
    queryKey:["staff-form-requirements",user?.id,clientId??"all"],
    queryFn:()=>read({data:{clientId}}),
    enabled:!!user && (accountRole==="admin" || accountRole==="coach"),
    staleTime:15000,
    refetchOnWindowFocus:true,
  });
}

export function RequirementCount({title,requirements}: {title:string;requirements:StaffFormRequirement[]}) {
  const [open,setOpen]=useState(false);
  const missing=requirements.filter(r=>!r.complete);
  if(!missing.length) return null;
  const people=new Set(missing.map(r=>r.clientId)).size;
  return <>
    <Button variant="ghost" size="sm" className="h-10 shrink-0 px-2 text-warning tabular-nums" aria-label={`${people} accounts need ${title}`} onClick={()=>setOpen(true)}>{people} needed</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{title} · outstanding</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">{people} {people===1?"account":"accounts"} · {missing.length} {missing.length===1?"requirement":"requirements"}</p>
        <ul className="divide-y divide-border">
          {missing.map((r,i)=><li key={r.clientId+":"+r.key+":"+i} className="flex items-center justify-between gap-2 py-2 text-sm">
            <ClientNameLink clientId={r.clientId} tab="agreements" className="min-w-0 font-medium hover:underline">{r.name}{r.occurrence && <span className="block text-xs font-normal text-muted-foreground">{r.occurrence}</span>}</ClientNameLink>
            <span className="shrink-0 text-xs text-warning">Needed</span>
          </li>)}
        </ul>
      </DialogContent>
    </Dialog>
  </>;
}

/** Native submissions keep their original viewer. This compact section fills
 * the gaps for account requirements that do not have an assignment yet. */
export function AccountFormRequirements({clientId,onOpenSetup}: {clientId:string;onOpenSetup?:(key:string)=>void}) {
  const q=useStaffFormRequirements(clientId);
  const [selected,setSelected]=useState<StaffFormRequirement|null>(null);
  const read=useServerFn(getStaffFormAcceptanceEvidence);
  const detail=useQuery({queryKey:["staff-form-requirements-evidence",clientId,selected?.recordId],enabled:!!selected?.recordId,queryFn:()=>read({data:{clientId,id:selected!.recordId!}})});
  if(q.isLoading) return <p className="text-xs text-muted-foreground">Checking account requirements…</p>;
  if(q.isError) return <Button variant="ghost" size="sm" onClick={()=>void q.refetch()}>Couldn't check account requirements · Retry</Button>;
  const all=q.data??[];
  const missing=all.filter(r=>!r.complete);
  const accepted=all.filter(r=>r.complete && r.key.startsWith("legal:"));
  if(!missing.length && !accepted.length) return null;
  return <div className="space-y-2" data-account-form-requirements>
    {missing.length>0 && <div>
      <h4 className="mb-1 text-xs font-semibold text-muted-foreground">Required account forms · {missing.length} needed</h4>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {missing.map((r,i)=><li key={r.key+":"+i}><button type="button" disabled={!onOpenSetup || r.key.startsWith("legal:")} onClick={()=>onOpenSetup?.(r.key)} className="flex min-h-10 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm disabled:opacity-100">
          <span>{r.title}{r.occurrence && <span className="block text-xs text-muted-foreground">{r.occurrence}</span>}</span>
          <span className="shrink-0 text-xs text-warning">Needed</span>
        </button></li>)}
      </ul>
    </div>}
    {accepted.length>0 && <div>
      <h4 className="mb-1 text-xs font-semibold text-muted-foreground">Accepted account terms</h4>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {accepted.map(r=><li key={r.key}><button type="button" disabled={!r.recordId} onClick={()=>setSelected(r)} className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <span className="min-w-0 flex-1">{r.title}</span>
          <span className="text-xs text-muted-foreground">{r.acceptedAt ? new Date(r.acceptedAt).toLocaleDateString() : "Accepted"}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground"/>
        </button></li>)}
      </ul>
    </div>}
    {selected && <Dialog open onOpenChange={o=>{if(!o)setSelected(null)}}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{selected.title}</DialogTitle></DialogHeader>
        {detail.isLoading ? <p>Loading accepted document…</p> : detail.isError ? <Button variant="outline" onClick={()=>void detail.refetch()}>Retry</Button> : detail.data && <div className="space-y-3 text-sm">
          <p>Accepted {selected.acceptedAt ? new Date(selected.acceptedAt).toLocaleString() : "—"} · {detail.data.method ?? "Method not recorded"}</p>
          {detail.data.acknowledgement && <p className="whitespace-pre-wrap">{detail.data.acknowledgement}</p>}
          <details><summary className="cursor-pointer font-medium">Original accepted document</summary><p className="mt-2 whitespace-pre-wrap break-words">{detail.data.snapshot ?? "No document snapshot recorded."}</p></details>
        </div>}
      </DialogContent>
    </Dialog>}
  </div>;
}
