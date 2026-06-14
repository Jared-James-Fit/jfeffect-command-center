import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Plus, Calendar, Target, Layers, History, BarChart3, BookOpen, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { listClientPreps, listClientBlocks, createPrep, createBlock, countdownLabel, updatePrep, updateBlock, GOAL_TYPES, PREP_STATUSES, BLOCK_STATUSES, type PrepStatus, type BlockStatus } from "@/lib/pl-programs";
import { BLOCK_PHASE_OPTIONS } from "@/lib/pl-template-blocks";
import { ClientTrainingIntelCard } from "@/components/client-training-intel-card";

export const Route = createFileRoute("/_authenticated/admin/client-programs/$clientId_")({ component: ClientProgramsPage });

function ClientProgramsPage() {
  const { clientId } = Route.useParams();
  const qc = useQueryClient();
  const [prepOpen, setPrepOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);

  const { data: client } = useQuery({
    queryKey: ["client", clientId],
    queryFn: async () => (await supabase.from("clients").select("id, full_name").eq("id", clientId).maybeSingle()).data,
  });
  const { data: preps = [] } = useQuery({ queryKey: ["pl-preps", clientId], queryFn: () => listClientPreps(clientId) });
  const { data: blocks = [] } = useQuery({ queryKey: ["pl-blocks", clientId], queryFn: () => listClientBlocks(clientId) });

  const templateIds = Array.from(new Set([
    ...(preps as any[]).map((p) => p.source_template_id).filter(Boolean),
    ...(blocks as any[]).map((b) => b.source_template_id).filter(Boolean),
  ])) as string[];
  const { data: templateLookup = {} } = useQuery({
    queryKey: ["pl-templates-by-id", templateIds.sort().join(",")],
    enabled: templateIds.length > 0,
    queryFn: async () => {
      const { data } = await (supabase as any).from("pl_templates").select("id, name").in("id", templateIds);
      const map: Record<string, { id: string; name: string }> = {};
      for (const t of (data ?? []) as any[]) map[t.id] = t;
      return map;
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["pl-preps", clientId] });
    qc.invalidateQueries({ queryKey: ["pl-blocks", clientId] });
  };

  return (
    <>
      <PageHeader
        backTo="/admin/clients"
        backLabel={client?.full_name ? `Back to ${client.full_name}` : "Back to Clients"}
        breadcrumbs={[
          { label: "Clients", to: "/admin/clients" },
          ...(client?.full_name ? [{ label: client.full_name, to: `/admin/clients/${clientId}` }] : []),
          { label: "Training Program" },
        ]}
        title="Training Program"
        subtitle={client?.full_name ?? ""}
      />
      <div className="p-6 md:p-8 space-y-6">
        <Link to="/admin/clients/$id" params={{ id: clientId }} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to client
        </Link>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setPrepOpen(true)}><Target className="mr-2 h-4 w-4" /> New Prep / Phase</Button>
          <Button onClick={() => setBlockOpen(true)} variant="outline"><Layers className="mr-2 h-4 w-4" /> New Block</Button>
          <Link to="/admin/client-programs/$clientId/history" params={{ clientId }}>
            <Button variant="outline"><History className="mr-2 h-4 w-4" /> History</Button>
          </Link>
          <Link to="/admin/client-programs/$clientId/analytics" params={{ clientId }}>
            <Button variant="outline"><BarChart3 className="mr-2 h-4 w-4" /> Analytics & PRs</Button>
          </Link>
        </div>

        <ClientTrainingIntelCard clientId={clientId} />

        <section>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-muted-foreground">Preps / Phases</h2>
          {preps.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground">No preps yet.</Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {(preps as any[]).map((p) => {
                const cd = countdownLabel(p.event_date);
                const blocksInPrep = (blocks as any[]).filter((b) => b.prep_id === p.id);
                return (
                  <Card key={p.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-bold text-lg">{p.title}</div>
                        <div className="text-xs text-muted-foreground">{p.goal_type}</div>
                        {p.source_template_id && (templateLookup as any)[p.source_template_id] && (
                          <Link
                            to="/admin/program-library/$templateId"
                            params={{ templateId: p.source_template_id }}
                            className="mt-1 inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/10"
                          >
                            <BookOpen className="h-2.5 w-2.5" /> From template: {(templateLookup as any)[p.source_template_id].name}
                          </Link>
                        )}
                      </div>
                      <Select value={p.status} onValueChange={async (v) => { await updatePrep(p.id, { status: v as PrepStatus }); refresh(); toast.success(`Status: ${v}`); }}>
                        <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{PREP_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    {p.event_name && (
                      <div className="mt-2 text-sm">
                        <Calendar className="mr-1 inline h-3 w-3" />{p.event_name}
                        {p.event_date && <span className="text-muted-foreground"> · {p.event_date}</span>}
                        {cd && <Badge className="ml-2" variant="secondary">{cd}</Badge>}
                      </div>
                    )}
                    {p.total_weeks && (
                      <div className="mt-1 text-xs text-muted-foreground">{p.total_weeks} weeks total · {blocksInPrep.length} block(s) programmed</div>
                    )}
                    <div className="mt-3 space-y-1">
                      {blocksInPrep.map((b) => (
                        <Link key={b.id} to="/admin/blocks/$blockId" params={{ blockId: b.id }} className="block rounded border border-border bg-secondary/30 p-2 text-sm hover:bg-secondary/50">
                          <span className="font-semibold">{b.name}</span>
                          <span className="ml-2 text-xs text-muted-foreground">{b.weeks}w · {b.training_focus ?? "—"}</span>
                        </Link>
                      ))}
                      {blocksInPrep.length === 0 && <p className="text-xs italic text-muted-foreground">No blocks programmed yet.</p>}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <BlocksSection
            blocks={blocks as any[]}
            templateLookup={templateLookup as any}
            onRefresh={refresh}
          />
        </section>
      </div>

      <NewPrepDialog open={prepOpen} onOpenChange={setPrepOpen} clientId={clientId} onCreated={refresh} />
      <NewBlockDialog open={blockOpen} onOpenChange={setBlockOpen} clientId={clientId} preps={preps as any[]} onCreated={refresh} />
    </>
  );
}

function BlocksSection({ blocks, templateLookup, onRefresh }: { blocks: any[]; templateLookup: any; onRefresh: () => void }) {
  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);
  const isPrevious = (b: any) => {
    if (b.status === "Completed" || b.status === "Archived") return true;
    if (b.end_date && new Date(b.end_date) < today) return true;
    return false;
  };
  const isUpcoming = (b: any) =>
    !isPrevious(b) && !!b.start_date && b.start_date > todayISO;
  const upcoming = blocks
    .filter(isUpcoming)
    .sort((a, b) => (a.start_date ?? "").localeCompare(b.start_date ?? ""));
  const current = blocks.filter((b) => !isPrevious(b) && !isUpcoming(b));
  const previous = blocks.filter(isPrevious);

  if (blocks.length === 0) {
    return <Card className="p-6 text-sm text-muted-foreground">No blocks yet.</Card>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-muted-foreground">Current Blocks</h2>
        {current.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">No active blocks.</Card>
        ) : (
          <div className="grid gap-2">
            {current.map((b) => <BlockRow key={b.id} b={b} templateLookup={templateLookup} onRefresh={onRefresh} />)}
          </div>
        )}
      </div>
      {upcoming.length > 0 && (
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" /> Upcoming Blocks ({upcoming.length})
          </h2>
          <div className="grid gap-2">
            {upcoming.map((b) => {
              const daysUntil = Math.max(
                0,
                Math.ceil((new Date(b.start_date + "T00:00:00").getTime() - today.getTime()) / 86400000),
              );
              return (
                <div key={b.id} className="relative">
                  <BlockRow b={b} templateLookup={templateLookup} onRefresh={onRefresh} />
                  <Badge variant="secondary" className="absolute right-32 top-3 text-[10px]">
                    Starts in {daysUntil}d
                  </Badge>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {previous.length > 0 && (
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
            <History className="h-3.5 w-3.5" /> Previous Blocks
          </h2>
          <div className="grid gap-2">
            {previous.map((b) => <BlockRow key={b.id} b={b} templateLookup={templateLookup} onRefresh={onRefresh} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function BlockRow({ b, templateLookup, onRefresh }: { b: any; templateLookup: any; onRefresh: () => void }) {
  return (
    <Card className="p-3 flex items-center justify-between hover:bg-secondary/30">
      <Link to="/admin/blocks/$blockId" params={{ blockId: b.id }} className="flex-1">
        <div>
          <div className="font-bold">{b.name}</div>
          <div className="text-xs text-muted-foreground">
            {b.weeks} weeks · {b.training_focus ?? "—"}
            {b.start_date && ` · ${b.start_date}`}{b.end_date && ` – ${b.end_date}`}
          </div>
          {b.source_template_id && templateLookup[b.source_template_id] && (
            <div className="mt-1 inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[10px] text-primary">
              <BookOpen className="h-2.5 w-2.5" /> From template: {templateLookup[b.source_template_id].name}
            </div>
          )}
        </div>
      </Link>
      <Select value={b.status} onValueChange={async (v) => { await updateBlock(b.id, { status: v as BlockStatus }); onRefresh(); toast.success(`Status: ${v}`); }}>
        <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>{BLOCK_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
      </Select>
    </Card>
  );
}

function NewPrepDialog({ open, onOpenChange, clientId, onCreated }: any) {
  const [form, setForm] = useState({ title: "", goal_type: "Powerlifting Competition", event_name: "", event_date: "", total_weeks: 12, status: "Active" as PrepStatus });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Prep / Phase</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. NAPF 2026 Prep" /></div>
          <div><Label>Goal Type</Label>
            <Select value={form.goal_type} onValueChange={(v) => setForm({ ...form, goal_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{GOAL_TYPES.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Event Name</Label><Input value={form.event_name} onChange={(e) => setForm({ ...form, event_name: e.target.value })} /></div>
            <div><Label>Event Date</Label><Input type="date" value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Total Weeks</Label><Input type="number" value={form.total_weeks} onChange={(e) => setForm({ ...form, total_weeks: parseInt(e.target.value) || 0 })} /></div>
            <div><Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as PrepStatus })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["Planned", "Active", "Completed", "Archived"] as PrepStatus[]).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={async () => {
            if (!form.title) return toast.error("Title required");
            try {
              await createPrep({
                client_id: clientId, title: form.title, goal_type: form.goal_type,
                event_name: form.event_name || null, event_date: form.event_date || null,
                total_weeks: form.total_weeks || null, status: form.status,
              });
              toast.success("Prep created");
              onCreated(); onOpenChange(false);
            } catch (e: any) { toast.error(e.message); }
          }}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewBlockDialog({ open, onOpenChange, clientId, preps, onCreated }: any) {
  const [form, setForm] = useState({ name: "", weeks: 4, training_focus: "Volume", prep_id: "none" });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Block</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Volume / Positioning" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Weeks</Label><Input type="number" value={form.weeks} onChange={(e) => setForm({ ...form, weeks: parseInt(e.target.value) || 1 })} /></div>
            <div><Label>Focus</Label>
              <Select value={form.training_focus} onValueChange={(v) => setForm({ ...form, training_focus: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TRAINING_FOCUSES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Link to Prep (optional)</Label>
            <Select value={form.prep_id} onValueChange={(v) => setForm({ ...form, prep_id: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Standalone block —</SelectItem>
                {preps.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={async () => {
            if (!form.name) return toast.error("Name required");
            try {
              await createBlock({
                client_id: clientId, name: form.name, weeks: form.weeks,
                training_focus: form.training_focus, prep_id: form.prep_id === "none" ? null : form.prep_id,
              });
              toast.success("Block created with seeded weeks");
              onCreated(); onOpenChange(false);
            } catch (e: any) { toast.error(e.message); }
          }}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}