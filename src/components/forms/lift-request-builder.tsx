import { useRef, useState } from "react";
import { Plus, Minus, ChevronDown, ChevronRight, ArrowUp, ArrowDown, Copy, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createLiftRequestDraft, getForm, type NfForm } from "@/lib/native-forms";
import { LIFT_REQUEST_TEMPLATES, makeLiftDraft, liftRequestCount, validateLiftDraft, type LiftDraftGroup, type LiftDraftItem, type LiftRequestTemplate } from "@/lib/lift-request-template";

const freshItem = (title = ""): LiftDraftItem => ({ id: crypto.randomUUID(), title, instructions: "" });
const move = <T,>(a: T[], i: number, d: number) => { const j = i + d; if (j < 0 || j >= a.length) return a; const b = [...a]; [b[i], b[j]] = [b[j], b[i]]; return b; };

export function LiftRequestBuilder({ onClose, onCreated }: { onClose: () => void; onCreated: (form: NfForm) => void | Promise<void> }) {
  const [draft, setDraft] = useState(() => makeLiftDraft("final"));
  const [template, setTemplate] = useState<LiftRequestTemplate>("final");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const created = useRef<string | null>(null);
  const count = liftRequestCount(draft);
  const error = validateLiftDraft(draft);
  function updateGroup(id: string, edit: (g: LiftDraftGroup) => LiftDraftGroup) {
    setDraft(d => ({ ...d, groups: d.groups.map(g => g.id === id ? edit(g) : g) }));
  }
  function updateItem(groupId: string, itemId: string, patch: Partial<LiftDraftItem>) {
    updateGroup(groupId, g => ({ ...g, items: g.items.map(i => i.id === itemId ? { ...i, ...patch } : i) }));
  }
  async function save() {
    if (saving.current || error) return;
    saving.current = true; setBusy(true);
    try {
      const id = created.current ?? await createLiftRequestDraft(draft);
      created.current = id;
      const form = await getForm(id);
      if (!form) throw new Error("Draft saved; reopen it in your Forms library.");
      await onCreated(form);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't create request."); }
    finally { saving.current = false; setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={v => { if (!v && !busy) onClose(); }}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Lift request</DialogTitle><DialogDescription>Customize the lifts before sending. Athletes can submit whatever they have.</DialogDescription></DialogHeader>
        <fieldset disabled={busy || !!created.current} className="space-y-3">
          <label className="block space-y-1 text-sm font-medium">Template
            <select className="block h-11 w-full rounded-md border bg-background px-3 text-base" value={template} onChange={e => { const t = e.target.value as LiftRequestTemplate; setTemplate(t); setDraft(makeLiftDraft(t)); setExpanded({}); }}>
              {Object.entries(LIFT_REQUEST_TEMPLATES).map(([key, v]) => <option key={key} value={key}>{v.title}</option>)}
            </select>
          </label>
          <label className="block space-y-1 text-sm font-medium">Title<Input value={draft.title} maxLength={120} onChange={e => setDraft(d => ({...d, title:e.target.value}))} className="text-base" /></label>
          {draft.groups.map((g, n) => {
            const open = expanded[g.id] ?? n === 0;
            return <div key={g.id} className="rounded-xl border p-2">
              <div className="flex items-center gap-1">
                <button type="button" className="grid h-10 w-8 shrink-0 place-items-center" aria-label={open ? "Collapse exercise" : "Expand exercise"} aria-expanded={open} onClick={() => setExpanded(e => ({...e,[g.id]:!open}))}>{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
                <Input aria-label="Exercise name" value={g.exercise} maxLength={80} onChange={e => updateGroup(g.id, x => ({...x, exercise:e.target.value}))} className="min-w-0 flex-1 text-base" />
                <Button type="button" size="icon" variant="ghost" disabled={!g.items.length} aria-label="Remove last lift" onClick={() => updateGroup(g.id, x => ({...x, items:x.items.slice(0,-1)}))}><Minus className="h-4 w-4" /></Button>
                <span className="w-5 text-center tabular-nums">{g.items.length}</span>
                <Button type="button" size="icon" variant="ghost" disabled={count >= 36} aria-label="Add lift" onClick={() => { updateGroup(g.id, x => ({...x, items:[...x.items,freshItem()]})); setExpanded(e => ({...e,[g.id]:true})); }}><Plus className="h-4 w-4" /></Button>
              </div>
              {open && <div className="mt-2 space-y-2">
                {g.items.map((item, i) => <div key={item.id} className="space-y-1 rounded-md bg-muted/40 p-2">
                  <div className="flex items-center gap-1">
                    <Input aria-label={`Lift ${i+1} title`} placeholder="Lift title" value={item.title} maxLength={120} onChange={e => updateItem(g.id,item.id,{title:e.target.value})} className="min-w-0 flex-1 text-base" />
                    <Button type="button" variant="ghost" size="icon" aria-label="Remove lift" onClick={() => updateGroup(g.id,x=>({...x,items:x.items.filter(v=>v.id!==item.id)}))}><X className="h-4 w-4" /></Button>
                  </div>
                  <Input aria-label="Optional lift instructions" placeholder="Instructions (optional)" value={item.instructions} maxLength={500} onChange={e=>updateItem(g.id,item.id,{instructions:e.target.value})} className="text-base" />
                  <div className="flex justify-end">
                    <Button type="button" variant="ghost" size="icon" disabled={i===0} aria-label="Move lift up" onClick={()=>updateGroup(g.id,x=>({...x,items:move(x.items,i,-1)}))}><ArrowUp className="h-4 w-4" /></Button>
                    <Button type="button" variant="ghost" size="icon" disabled={i===g.items.length-1} aria-label="Move lift down" onClick={()=>updateGroup(g.id,x=>({...x,items:move(x.items,i,1)}))}><ArrowDown className="h-4 w-4" /></Button>
                    <Button type="button" variant="ghost" size="icon" disabled={count>=36} aria-label="Duplicate lift" onClick={()=>updateGroup(g.id,x=>({...x,items:[...x.items.slice(0,i+1),{...item,id:crypto.randomUUID()},...x.items.slice(i+1)]}))}><Copy className="h-4 w-4" /></Button>
                  </div>
                </div>)}
                <Button type="button" variant="outline" size="sm" disabled={!g.items.length || g.items.length*draft.groups.length>36} onClick={()=>setDraft(d=>({...d,groups:d.groups.map(x=>x.id===g.id?x:{...x,items:g.items.map(i=>({...i,id:crypto.randomUUID()}))})}))}>Apply to all exercises</Button>
              </div>}
            </div>;
          })}
          <Button type="button" variant="outline" className="w-full" disabled={draft.groups.length>=12} onClick={()=>setDraft(d=>({...d,groups:[...d.groups,{id:crypto.randomUUID(),exercise:"",items:[freshItem()]}]}))}><Plus className="mr-1 h-4 w-4" /> Add exercise</Button>
          <Textarea value={draft.instructions} onChange={e=>setDraft(d=>({...d,instructions:e.target.value}))} placeholder="Overall instructions (optional)" maxLength={1500} rows={2} />
        </fieldset>
        <p className="text-sm text-muted-foreground">{count} requested lifts · Partial submissions allowed</p>
        <Button className="h-12 w-full" disabled={busy || !!error} onClick={()=>void save()}>{busy?"Saving…":"Continue to send"}</Button>
      </DialogContent>
    </Dialog>
  );
}
