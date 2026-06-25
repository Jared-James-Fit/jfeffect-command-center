import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { MediaHeader } from "@/components/media/media-header";
import { BarChart3, Plus, Trash2 } from "lucide-react";

const PLATFORMS = ["instagram", "tiktok", "youtube", "facebook", "email", "x", "linkedin", "other"];

type Entry = {
  id: string;
  platform: string;
  content_id: string | null;
  campaign_id: string | null;
  publish_date: string | null;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  watch_time_seconds: number | null;
  leads: number | null;
  applications: number | null;
  sales: number | null;
  revenue_cents: number | null;
  source: "manual" | "integration";
  notes: string | null;
};

export function PerformancePage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [platformFilter, setPlatformFilter] = useState<string>("all");

  const { data: entries, isLoading } = useQuery({
    queryKey: ["media_performance_entries"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("media_performance_entries") as any)
        .select("*").order("publish_date", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data || []) as Entry[];
    },
  });

  const filtered = useMemo(() => {
    const list = entries || [];
    return platformFilter === "all" ? list : list.filter((e) => e.platform === platformFilter);
  }, [entries, platformFilter]);

  const totals = useMemo(() => sumTotals(filtered), [filtered]);

  return (
    <div className="mx-auto w-full max-w-7xl p-4 md:p-6">
      <MediaHeader
        title="Performance"
        description="Real integration data and clearly labelled manual results."
        actions={
          <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="mr-1.5 h-4 w-4" />Add Manual Results
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={platformFilter} onValueChange={setPlatformFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            {PLATFORMS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          We do not invent data. Only real integration or manual entries appear here.
        </span>
      </div>

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          <BarChart3 className="mx-auto mb-3 h-10 w-10 opacity-50" />
          <p className="mb-1">No performance entries yet.</p>
          <p className="mb-4 text-xs">Integrations aren't connected. Log results manually to start tracking.</p>
          <Button onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="mr-1.5 h-4 w-4" />Add Manual Results
          </Button>
        </Card>
      ) : (
        <>
          <TotalsGrid totals={totals} />
          <EntriesTable entries={filtered} onEdit={(e) => { setEditing(e); setOpen(true); }}
            onDeleted={() => qc.invalidateQueries({ queryKey: ["media_performance_entries"] })} />
        </>
      )}

      <EntryDialog
        open={open} onOpenChange={setOpen} editing={editing}
        onSaved={() => qc.invalidateQueries({ queryKey: ["media_performance_entries"] })}
      />
    </div>
  );
}

function sumTotals(entries: Entry[]) {
  return entries.reduce(
    (a, e) => ({
      views: a.views + (e.views || 0),
      reach: a.reach + (e.reach || 0),
      likes: a.likes + (e.likes || 0),
      comments: a.comments + (e.comments || 0),
      shares: a.shares + (e.shares || 0),
      saves: a.saves + (e.saves || 0),
      leads: a.leads + (e.leads || 0),
      sales: a.sales + (e.sales || 0),
      revenueCents: a.revenueCents + (e.revenue_cents || 0),
      posts: a.posts + 1,
    }),
    { views: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, leads: 0, sales: 0, revenueCents: 0, posts: 0 },
  );
}

function TotalsGrid({ totals }: { totals: ReturnType<typeof sumTotals> }) {
  const engagement = totals.views ? ((totals.likes + totals.comments + totals.shares + totals.saves) / totals.views) * 100 : null;
  const shareRate = totals.views ? (totals.shares / totals.views) * 100 : null;
  const saveRate = totals.views ? (totals.saves / totals.views) * 100 : null;
  const leadConv = totals.views ? (totals.leads / totals.views) * 100 : null;
  const rpp = totals.posts ? totals.revenueCents / 100 / totals.posts : null;
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
      <Tot label="Views" value={totals.views} />
      <Tot label="Reach" value={totals.reach} />
      <Tot label="Leads" value={totals.leads} />
      <Tot label="Sales" value={totals.sales} />
      <Tot label="Revenue" value={`$${Math.round(totals.revenueCents / 100).toLocaleString()}`} />
      <Tot label="Engagement" value={engagement == null ? "—" : `${engagement.toFixed(2)}%`} />
      <Tot label="Share rate" value={shareRate == null ? "—" : `${shareRate.toFixed(2)}%`} />
      <Tot label="Save rate" value={saveRate == null ? "—" : `${saveRate.toFixed(2)}%`} />
      <Tot label="Lead conv" value={leadConv == null ? "—" : `${leadConv.toFixed(2)}%`} />
      <Tot label="Revenue / post" value={rpp == null ? "—" : `$${rpp.toFixed(2)}`} />
    </div>
  );
}

function Tot({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="p-3">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{typeof value === "number" ? value.toLocaleString() : value}</div>
    </Card>
  );
}

function EntriesTable({
  entries, onEdit, onDeleted,
}: { entries: Entry[]; onEdit: (e: Entry) => void; onDeleted: () => void }) {
  async function remove(id: string) {
    if (!confirm("Delete this entry?")) return;
    const { error } = await (supabase.from("media_performance_entries") as any).delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted"); onDeleted();
  }
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
          <tr>
            {["Platform", "Date", "Views", "Reach", "Engagement", "Leads", "Sales", "Revenue", "Source", ""].map((h) => (
              <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-t hover:bg-muted/30">
              <td className="px-3 py-2"><button onClick={() => onEdit(e)} className="font-medium hover:underline">{e.platform}</button></td>
              <td className="px-3 py-2">{e.publish_date || "—"}</td>
              <td className="px-3 py-2">{(e.views ?? 0).toLocaleString()}</td>
              <td className="px-3 py-2">{(e.reach ?? 0).toLocaleString()}</td>
              <td className="px-3 py-2">{((e.likes || 0) + (e.comments || 0) + (e.shares || 0) + (e.saves || 0)).toLocaleString()}</td>
              <td className="px-3 py-2">{e.leads ?? 0}</td>
              <td className="px-3 py-2">{e.sales ?? 0}</td>
              <td className="px-3 py-2">${Math.round((e.revenue_cents || 0) / 100).toLocaleString()}</td>
              <td className="px-3 py-2">
                <Badge variant={e.source === "manual" ? "outline" : "default"}>{e.source}</Badge>
              </td>
              <td className="px-3 py-2 text-right">
                <Button size="icon" variant="ghost" onClick={() => remove(e.id)} aria-label="Delete">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function EntryDialog({
  open, onOpenChange, editing, onSaved,
}: { open: boolean; onOpenChange: (b: boolean) => void; editing: Entry | null; onSaved: () => void }) {
  const empty = {
    platform: "instagram", publish_date: "", views: "", reach: "",
    likes: "", comments: "", shares: "", saves: "", watch_time_seconds: "",
    leads: "", applications: "", sales: "", revenue: "", notes: "",
    content_id: "", campaign_id: "",
  };
  const [v, setV] = useState<Record<string, string>>(empty);
  const [saving, setSaving] = useState(false);

  // sync when opening with editing
  useMemo(() => {
    if (!open) return;
    if (editing) {
      setV({
        platform: editing.platform,
        publish_date: editing.publish_date ?? "",
        views: s(editing.views), reach: s(editing.reach), likes: s(editing.likes),
        comments: s(editing.comments), shares: s(editing.shares), saves: s(editing.saves),
        watch_time_seconds: s(editing.watch_time_seconds),
        leads: s(editing.leads), applications: s(editing.applications), sales: s(editing.sales),
        revenue: editing.revenue_cents != null ? String(editing.revenue_cents / 100) : "",
        notes: editing.notes ?? "",
        content_id: editing.content_id ?? "", campaign_id: editing.campaign_id ?? "",
      });
    } else { setV(empty); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);

  function set(k: string, val: string) { setV((p) => ({ ...p, [k]: val })); }

  async function save() {
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const payload: any = {
      platform: v.platform,
      publish_date: v.publish_date || null,
      views: n(v.views), reach: n(v.reach), likes: n(v.likes), comments: n(v.comments),
      shares: n(v.shares), saves: n(v.saves), watch_time_seconds: n(v.watch_time_seconds),
      leads: n(v.leads), applications: n(v.applications), sales: n(v.sales),
      revenue_cents: v.revenue ? Math.round(Number(v.revenue) * 100) : null,
      notes: v.notes || null,
      content_id: v.content_id || null,
      campaign_id: v.campaign_id || null,
      source: "manual",
    };
    if (!editing) payload.created_by = u.user?.id;
    const res = editing
      ? await (supabase.from("media_performance_entries") as any).update(payload).eq("id", editing.id)
      : await (supabase.from("media_performance_entries") as any).insert(payload);
    setSaving(false);
    if (res.error) return toast.error(res.error.message);
    toast.success("Saved"); onOpenChange(false); onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{editing ? "Edit entry" : "Add manual results"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Platform">
            <Select value={v.platform} onValueChange={(x) => set("platform", x)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PLATFORMS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Publish date"><Input type="date" value={v.publish_date} onChange={(e) => set("publish_date", e.target.value)} /></Field>
          {[
            ["views","Views"],["reach","Reach"],["likes","Likes"],["comments","Comments"],
            ["shares","Shares"],["saves","Saves"],["watch_time_seconds","Watch time (s)"],
            ["leads","Leads"],["applications","Applications"],["sales","Sales"],
          ].map(([k, label]) => (
            <Field key={k} label={label}>
              <Input inputMode="numeric" value={v[k]} onChange={(e) => set(k, e.target.value)} />
            </Field>
          ))}
          <Field label="Revenue ($)">
            <Input inputMode="decimal" value={v.revenue} onChange={(e) => set("revenue", e.target.value)} />
          </Field>
          <Field label="Linked content ID (optional)">
            <Input value={v.content_id} onChange={(e) => set("content_id", e.target.value)} placeholder="uuid" />
          </Field>
          <Field label="Linked campaign ID (optional)">
            <Input value={v.campaign_id} onChange={(e) => set("campaign_id", e.target.value)} placeholder="uuid" />
          </Field>
          <div className="md:col-span-2">
            <Field label="Notes"><Textarea rows={2} value={v.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs">{label}</Label>{children}</div>;
}
function n(s: string): number | null { if (!s) return null; const x = Number(s); return Number.isFinite(x) ? x : null; }
function s(v: number | null | undefined): string { return v == null ? "" : String(v); }