import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Inbox, ShieldCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AgreementRecordViewer } from "@/components/coaching-agreement/agreement-record-viewer";
import { ClientNameLink } from "@/components/clients/client-name-link";
import { useAuth } from "@/lib/auth";
import { listAgreementFormRecords, getLegalFormEvidence, type AgreementFormGroup, type AgreementFormRecord } from "@/lib/agreement-form-records.functions";

export function useAgreementFormGroups() {
  const { accountRole, user } = useAuth();
  const fn = useServerFn(listAgreementFormRecords);
  return useQuery({queryKey:["agreement-form-records",user?.id],queryFn:()=>fn(),enabled:accountRole === "admin" && !!user,staleTime:15000});
}
const isResponse = (r: AgreementFormRecord) => r.source !== "external" || ["Signed","Completed","Verified"].includes(r.status.split(" · ")[0]);
const formatDate = (d: string | null) => d ? new Date(d).toLocaleString() : "—";

export function AgreementFormRow({ group }: {group: AgreementFormGroup}) {
  const [open,setOpen] = useState(false);
  const [search,setSearch] = useState("");
  const [selected,setSelected] = useState<string|null>(null);
  const [signature,setSignature] = useState<string|null>(null);
  const [mode,setMode] = useState<"table"|"individual">("table");
  const count = group.records.filter(isResponse).length;
  const visible = group.records.filter(r => [r.name,r.status,r.version].some(v => v?.toLowerCase().includes(search.toLowerCase())));
  const index = visible.findIndex(r=>r.id===selected);
  const record = index >= 0 ? visible[index] : undefined;
  const detailFn = useServerFn(getLegalFormEvidence);
  const detail = useQuery({queryKey:["legal-form-evidence",record?.id],queryFn:()=>detailFn({data:{id:record!.id}}),enabled:open && mode==="individual" && record?.source==="legal"});
  function show() {setSearch("");setSelected(null);setMode("table");setOpen(true);}
  return <>
    <li className="flex items-center gap-1.5 px-2 py-2 sm:px-3" data-agreement-form-row>
      <span className="grid h-10 w-10 shrink-0 place-items-center text-muted-foreground"><ShieldCheck className="h-4 w-4"/></span>
      <button type="button" onClick={show} className="min-w-0 flex-1 py-1 text-left">
        <span className="block text-[16px] font-semibold leading-snug">{group.title} <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">System agreement</span></span>
        <span className="block text-[13px] text-muted-foreground">Agreements · {group.source === "external" ? "SignNow / external" : "In-app"}</span>
        <span className="block text-[13px] leading-snug">{count} {count===1?"submission":"submissions"}{group.source==="external" && group.records.length>count ? " · "+(group.records.length-count)+" other records":""}</span>
      </button>
      <Button variant="outline" size="sm" className="h-10 shrink-0 px-2.5 sm:px-3" onClick={show} aria-label={"Responses to "+group.title}><Inbox className="h-4 w-4 sm:mr-1.5"/><span className="hidden sm:inline">Responses</span><span className="ml-1 tabular-nums text-muted-foreground">{count}</span></Button>
    </li>
    {open && <Dialog open onOpenChange={setOpen}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{group.title}</DialogTitle></DialogHeader>
        <div className="text-sm text-muted-foreground">{count} submissions · {group.records.length} records · Original evidence</div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={mode==="table"?"default":"outline"} onClick={()=>setMode("table")}>Table</Button>
          <Button size="sm" variant={mode==="individual"?"default":"outline"} disabled={!visible.length} onClick={()=>{setSelected(record?.id ?? visible[0]?.id ?? null);setMode("individual")}}>Individual</Button>
          {group.source==="coaching" && <Button size="sm" variant="outline" asChild><Link to="/admin/coaching-agreements">Signing status</Link></Button>}
          {group.source==="external" && <><Button size="sm" variant="outline" asChild><Link to="/admin/forms" search={{tab:"agreements"}}>Manage agreements</Link></Button><Button size="sm" variant="outline" asChild><Link to="/admin/agreements/signed">Signed documents</Link></Button></>}
        </div>
        <Input value={search} onChange={e=>{setSearch(e.target.value);setMode("table");setSelected(null);}} placeholder="Search people, versions or status" />
        {mode==="table" && <div className="divide-y divide-border rounded-xl border border-border">
          {visible.map(r=><button key={r.id} type="button" className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-muted" onClick={()=>{setSelected(r.id);setMode("individual")}}>
            <span className="min-w-0"><span className="block break-words font-medium">{r.name}</span><span className="block text-xs text-muted-foreground">{formatDate(r.date)}{r.version ? " · v"+r.version:""}</span></span><span className="shrink-0 text-xs">{r.status}</span>
          </button>)}
          {!visible.length && <p className="p-4 text-sm text-muted-foreground">No matching records.</p>}
        </div>}
        {mode==="individual" && record && <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Button variant="outline" size="icon" aria-label="Previous record" disabled={index===0} onClick={()=>setSelected(visible[index-1].id)}><ChevronLeft className="h-4 w-4"/></Button>
            <span className="text-sm">{index+1} of {visible.length}</span>
            <Button variant="outline" size="icon" aria-label="Next record" disabled={index===visible.length-1} onClick={()=>setSelected(visible[index+1].id)}><ChevronRight className="h-4 w-4"/></Button>
          </div>
          <div className="space-y-2 rounded-xl border border-border p-4">
            <p className="font-semibold">{record.name}</p>
            <p className="text-sm">Status: {record.status}</p><p className="text-sm">Recorded: {formatDate(record.date)}</p>
            <p className="text-sm">Version: {record.version ?? "Not recorded"}</p><p className="text-sm">Method: {record.method ?? "Not recorded"}</p>
            {record.acknowledgement && <p className="whitespace-pre-wrap text-sm">{record.acknowledgement}</p>}
            {record.source==="legal" && (detail.isLoading ? <p className="text-sm">Loading original evidence…</p> : detail.isError ? <Button variant="outline" onClick={()=>detail.refetch()}>Retry loading evidence</Button> : detail.data && <div className="space-y-2 text-sm">
              {detail.data.typedName && <p>Typed name: {detail.data.typedName}</p>}
              {detail.data.checked != null && <p>Checkbox: {detail.data.checked ? "Checked" : "Not checked"}</p>}
              {detail.data.context && <p>Context: {detail.data.context}</p>}
              {detail.data.revokedAt && <p>Revoked: {formatDate(detail.data.revokedAt)}</p>}
              <details><summary className="cursor-pointer font-medium">Original accepted document</summary><div className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-muted p-3">{detail.data.snapshot ?? "No document snapshot recorded."}</div></details>
            </div>)}
            <p className="break-all text-xs text-muted-foreground">Evidence ID: {record.id}</p>
            {record.clientId && <ClientNameLink clientId={record.clientId} tab="agreements">Open profile</ClientNameLink>}
            {record.source==="coaching" && <Button className="w-full" variant="outline" onClick={()=>{setOpen(false);setSignature(record.id)}}>View signed agreement</Button>}
          </div>
        </div>}
      </DialogContent>
    </Dialog>}
    {signature && <AgreementRecordViewer signatureId={signature} open onOpenChange={v=>{if(!v)setSignature(null)}}/>}
  </>;
}
