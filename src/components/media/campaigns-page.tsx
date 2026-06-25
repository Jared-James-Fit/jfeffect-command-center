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
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MediaHeader } from "@/components/media/media-header";
import { Plus, Megaphone, Archive, Trash2 } from "lucide-react";

const STATUS = ["planning", "active", "paused", "completed", "archived"] as const;
type Status = typeof STATUS[number];
const STATUS_LABEL: Record<Status, string> = {
  planning: "Planning", active: "Active", paused: "Paused",
  completed: "Completed", archived: "Archived",
};
const STATUS_TONE: Record<Status, string> = {
  planning: "bg-muted text-foreground",
  active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  paused: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  completed: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  archived: "bg-muted text-muted-foreground",
};

type Campaign = {
  id: string;
  name: string;
  objective: string | null;
  offer: string | null;
  target_audience: string | null;
  owner_id: string | null;
  team_member_ids: string[];
  start_date: string | null;
  end_date: string | null;
  status: Status;
  priority: number;
  description: string | null;
  landing_page_url: string | null;
  promo_link_urls: string[];
  lead_magnet_url: string | null;
  notes: string | null;
  results: string | null;
  archived: boolean;
  created_at: string;
};

export function CampaignsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Status | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: campaigns, isLoading } = useQuery({
    queryKey: ["media_campaigns"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("media_campaigns") as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as Campaign[];
    },
  });

  const filtered = useMemo(() => {
    const list = campaigns || [];
    if (filter === "all") return list.filter((c) => !c.archived || c.status === "archived");
    return list.filter((c) => c.status === filter);
  }, [campaigns, filter]);

  return (
    <div className="mx-auto w-full max-w-7xl p-4 md:p-6">
      <MediaHeader
        title="Campaigns"
        description="Full campaign containers: content, tasks, assets, links, performance."
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />New Campaign
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label="All" />
        {STATUS.map((s) => (
          <FilterChip key={s} active={filter === s} onClick={() => setFilter(s)} label={STATUS_LABEL[s]} />
        ))}
      </div>

      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          <Megaphone className="mx-auto mb-3 h-10 w-10 opacity-50" />
          <p className="mb-3">No campaigns {filter !== "all" ? `in "${STATUS_LABEL[filter as Status]}"` : "yet"}.</p>
          <Button onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 h-4 w-4" />Create campaign</Button>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <CampaignCard key={c.id} campaign={c} onOpen={() => setOpenId(c.id)} />
          ))}
        </div>
      )}

      <CampaignDrawer
        id={openId}
        onClose={() => setOpenId(null)}
        onMutated={() => qc.invalidateQueries({ queryKey: ["media_campaigns"] })}
      />

      <NewCampaignDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => {
          qc.invalidateQueries({ queryKey: ["media_campaigns"] });
          setOpenId(id);
        }}
      />
    </div>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
        active ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}

function CampaignCard({ campaign, onOpen }: { campaign: Campaign; onOpen: () => void }) {
  const { data: stats } = useQuery({
    queryKey: ["media_campaign_stats", campaign.id],
    queryFn: () => fetchCampaignStats(campaign.id),
    staleTime: 30_000,
  });
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen()}
      className="cursor-pointer p-4 transition hover:shadow-md focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 font-semibold leading-tight">{campaign.name}</h3>
        <Badge className={STATUS_TONE[campaign.status]} variant="outline">
          {STATUS_LABEL[campaign.status]}
        </Badge>
      </div>
      {campaign.objective && (
        <p className="mb-3 line-clamp-2 text-xs text-muted-foreground">{campaign.objective}</p>
      )}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat label="Content" value={stats?.content.total ?? 0} sub={`${stats?.content.published ?? 0} live`} />
        <Stat label="Tasks" value={stats?.tasks.total ?? 0} sub={`${stats?.tasks.done ?? 0} done`} />
        <Stat label="Scheduled" value={stats?.content.scheduled ?? 0} />
        <Stat label="Awaiting" value={stats?.content.awaiting ?? 0} />
      </div>
      {(stats?.overdue ?? 0) > 0 && (
        <div className="mt-2 text-xs text-destructive">{stats?.overdue} overdue</div>
      )}
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded border bg-muted/40 p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold leading-none">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

async function fetchCampaignStats(campaignId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const [content, tasks] = await Promise.all([
    (supabase.from("media_content_records") as any)
      .select("id, production_status, approval_status, due_date, archived")
      .eq("campaign_id", campaignId),
    (supabase.from("tasks") as any)
      .select("id, status, due_at")
      .eq("campaign_id", campaignId)
      .is("archived_at", null),
  ]);
  const cr = (content.data || []) as any[];
  const tr = (tasks.data || []) as any[];
  const liveCr = cr.filter((r) => !r.archived);
  return {
    content: {
      total: liveCr.length,
      published: liveCr.filter((r) => r.production_status === "published").length,
      scheduled: liveCr.filter((r) => r.production_status === "scheduled").length,
      awaiting: liveCr.filter((r) => r.approval_status === "awaiting_review").length,
    },
    tasks: {
      total: tr.length,
      done: tr.filter((t) => t.status === "done").length,
    },
    overdue:
      liveCr.filter((r) => r.due_date && r.due_date < today && r.production_status !== "published").length +
      tr.filter((t) => t.due_at && String(t.due_at).slice(0, 10) < today && t.status !== "done").length,
  };
}

function NewCampaignDialog({
  open, onOpenChange, onCreated,
}: { open: boolean; onOpenChange: (b: boolean) => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [saving, setSaving] = useState(false);

  async function create() {
    if (!name.trim()) return toast.error("Name required");
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const { data, error } = await (supabase.from("media_campaigns") as any)
      .insert({ name: name.trim(), objective: objective.trim() || null, created_by: u.user?.id, owner_id: u.user?.id })
      .select("id")
      .single();
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Campaign created");
    onOpenChange(false); setName(""); setObjective("");
    onCreated(data.id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New campaign</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Summer Coaching Push" />
          </div>
          <div>
            <Label>Objective</Label>
            <Textarea value={objective} onChange={(e) => setObjective(e.target.value)} rows={2}
              placeholder="What does this campaign aim to achieve?" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={create} disabled={saving}>{saving ? "Creating…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CampaignDrawer({
  id, onClose, onMutated,
}: { id: string | null; onClose: () => void; onMutated: () => void }) {
  const qc = useQueryClient();
  const { data: c } = useQuery({
    queryKey: ["media_campaign", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await (supabase.from("media_campaigns") as any)
        .select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data as Campaign | null;
    },
    enabled: !!id,
  });

  async function patch(updates: Partial<Campaign>) {
    if (!id) return;
    const { error } = await (supabase.from("media_campaigns") as any).update(updates).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["media_campaign", id] });
    qc.invalidateQueries({ queryKey: ["media_campaigns"] });
    onMutated();
  }

  async function archive() {
    if (!id) return;
    if (!confirm("Archive this campaign?")) return;
    await patch({ archived: true, status: "archived" } as any);
    onClose();
  }

  async function remove() {
    if (!id) return;
    if (!confirm("Permanently delete this campaign? Content, tasks, and assets remain.")) return;
    const { error } = await (supabase.from("media_campaigns") as any).delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Campaign deleted");
    onMutated();
    onClose();
  }

  return (
    <Sheet open={!!id} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
        {!c ? <Skeleton className="h-40" /> : (
          <>
            <SheetHeader>
              <div className="flex items-start justify-between gap-2">
                <SheetTitle className="text-xl">{c.name}</SheetTitle>
                <Badge className={STATUS_TONE[c.status]} variant="outline">{STATUS_LABEL[c.status]}</Badge>
              </div>
              <SheetDescription>
                {c.start_date || c.end_date
                  ? `${c.start_date ?? "—"} → ${c.end_date ?? "—"}`
                  : "No dates set"}
              </SheetDescription>
            </SheetHeader>

            <Tabs defaultValue="overview" className="mt-4">
              <TabsList className="flex w-full flex-wrap">
                {["overview","content","tasks","calendar","assets","links","performance","activity"].map((t) => (
                  <TabsTrigger key={t} value={t} className="capitalize">{t}</TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value="overview" className="mt-3">
                <OverviewForm campaign={c} onPatch={patch} />
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={archive}>
                    <Archive className="mr-1.5 h-3.5 w-3.5" />Archive
                  </Button>
                  <Button variant="destructive" size="sm" onClick={remove}>
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />Delete
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="content" className="mt-3"><RelatedContent campaignId={c.id} /></TabsContent>
              <TabsContent value="tasks" className="mt-3"><RelatedTasks campaignId={c.id} /></TabsContent>
              <TabsContent value="calendar" className="mt-3"><RelatedCalendar campaignId={c.id} /></TabsContent>
              <TabsContent value="assets" className="mt-3"><RelatedAssets campaignId={c.id} /></TabsContent>
              <TabsContent value="links" className="mt-3"><CampaignLinks campaign={c} onPatch={patch} /></TabsContent>
              <TabsContent value="performance" className="mt-3"><CampaignPerformance campaignId={c.id} /></TabsContent>
              <TabsContent value="activity" className="mt-3"><CampaignActivity campaign={c} /></TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function OverviewForm({ campaign, onPatch }: { campaign: Campaign; onPatch: (u: Partial<Campaign>) => void }) {
  const [local, setLocal] = useState(campaign);
  function set<K extends keyof Campaign>(k: K, v: Campaign[K]) { setLocal((p) => ({ ...p, [k]: v })); }
  function save() {
    onPatch({
      name: local.name, objective: local.objective, offer: local.offer,
      target_audience: local.target_audience, start_date: local.start_date,
      end_date: local.end_date, status: local.status, priority: local.priority,
      description: local.description, landing_page_url: local.landing_page_url,
      lead_magnet_url: local.lead_magnet_url, notes: local.notes, results: local.results,
    });
    toast.success("Saved");
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Name"><Input value={local.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Status">
          <Select value={local.status} onValueChange={(v) => set("status", v as Status)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{STATUS.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Objective"><Input value={local.objective ?? ""} onChange={(e) => set("objective", e.target.value)} /></Field>
        <Field label="Offer"><Input value={local.offer ?? ""} onChange={(e) => set("offer", e.target.value)} /></Field>
        <Field label="Target audience"><Input value={local.target_audience ?? ""} onChange={(e) => set("target_audience", e.target.value)} /></Field>
        <Field label="Priority (1–5)">
          <Input type="number" min={1} max={5} value={local.priority}
            onChange={(e) => set("priority", Math.max(1, Math.min(5, Number(e.target.value) || 3)))} />
        </Field>
        <Field label="Start date"><Input type="date" value={local.start_date ?? ""} onChange={(e) => set("start_date", e.target.value || null)} /></Field>
        <Field label="End date"><Input type="date" value={local.end_date ?? ""} onChange={(e) => set("end_date", e.target.value || null)} /></Field>
        <Field label="Landing page URL"><Input value={local.landing_page_url ?? ""} onChange={(e) => set("landing_page_url", e.target.value)} placeholder="https://…" /></Field>
        <Field label="Lead magnet URL"><Input value={local.lead_magnet_url ?? ""} onChange={(e) => set("lead_magnet_url", e.target.value)} placeholder="https://…" /></Field>
      </div>
      <Field label="Description">
        <Textarea rows={3} value={local.description ?? ""} onChange={(e) => set("description", e.target.value)} />
      </Field>
      <Field label="Internal notes">
        <Textarea rows={3} value={local.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <Field label="Results / outcome">
        <Textarea rows={3} value={local.results ?? ""} onChange={(e) => set("results", e.target.value)}
          placeholder="Recap once the campaign is wrapped." />
      </Field>
      <Button onClick={save}>Save</Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function RelatedContent({ campaignId }: { campaignId: string }) {
  const { data } = useQuery({
    queryKey: ["campaign_content", campaignId],
    queryFn: async () => {
      const { data } = await (supabase.from("media_content_records") as any)
        .select("id, title, production_status, approval_status, due_date, publish_date")
        .eq("campaign_id", campaignId).order("created_at", { ascending: false });
      return data || [];
    },
  });
  if (!data?.length) return <EmptyHint text="No content linked to this campaign yet. Tag content with this campaign from the Content Library." />;
  return (
    <ul className="divide-y rounded border">
      {data.map((r: any) => (
        <li key={r.id} className="flex items-center justify-between p-3 text-sm">
          <div className="min-w-0">
            <div className="truncate font-medium">{r.title}</div>
            <div className="text-xs text-muted-foreground">{r.production_status} · {r.approval_status}</div>
          </div>
          <div className="text-xs text-muted-foreground">{r.publish_date || r.due_date || ""}</div>
        </li>
      ))}
    </ul>
  );
}

function RelatedTasks({ campaignId }: { campaignId: string }) {
  const { data } = useQuery({
    queryKey: ["campaign_tasks", campaignId],
    queryFn: async () => {
      const { data } = await (supabase.from("tasks") as any)
        .select("id, title, status, due_at, priority_label")
        .eq("campaign_id", campaignId).is("archived_at", null)
        .order("due_at", { ascending: true, nullsFirst: false });
      return data || [];
    },
  });
  if (!data?.length) return <EmptyHint text="No tasks linked. Assign tasks to this campaign from My Work." />;
  return (
    <ul className="divide-y rounded border">
      {data.map((t: any) => (
        <li key={t.id} className="flex items-center justify-between p-3 text-sm">
          <div className="min-w-0">
            <div className="truncate font-medium">{t.title}</div>
            <div className="text-xs text-muted-foreground">{t.status} {t.priority_label ? `· ${t.priority_label}` : ""}</div>
          </div>
          <div className="text-xs text-muted-foreground">{t.due_at ? String(t.due_at).slice(0, 10) : ""}</div>
        </li>
      ))}
    </ul>
  );
}

function RelatedCalendar({ campaignId }: { campaignId: string }) {
  const { data } = useQuery({
    queryKey: ["campaign_calendar", campaignId],
    queryFn: async () => {
      const { data } = await (supabase.from("media_content_records") as any)
        .select("id, title, publish_date, publish_time, platform")
        .eq("campaign_id", campaignId).eq("archived", false)
        .not("publish_date", "is", null)
        .order("publish_date", { ascending: true });
      return data || [];
    },
  });
  if (!data?.length) return <EmptyHint text="No scheduled items. Schedule content with a publish date to see it here." />;
  return (
    <ul className="divide-y rounded border">
      {data.map((r: any) => (
        <li key={r.id} className="flex items-center justify-between p-3 text-sm">
          <div className="min-w-0"><div className="truncate font-medium">{r.title}</div><div className="text-xs text-muted-foreground">{r.platform || "—"}</div></div>
          <div className="text-xs">{r.publish_date}{r.publish_time ? ` ${String(r.publish_time).slice(0, 5)}` : ""}</div>
        </li>
      ))}
    </ul>
  );
}

function RelatedAssets({ campaignId }: { campaignId: string }) {
  const { data } = useQuery({
    queryKey: ["campaign_assets", campaignId],
    queryFn: async () => {
      const { data } = await (supabase.from("media_resources") as any)
        .select("id, title, kind, created_at").eq("campaign_id", campaignId)
        .order("created_at", { ascending: false });
      return data || [];
    },
  });
  if (!data?.length) return <EmptyHint text="No assets linked. Tag assets with this campaign from the Asset Library." />;
  return (
    <ul className="divide-y rounded border">
      {data.map((a: any) => (
        <li key={a.id} className="flex items-center justify-between p-3 text-sm">
          <div className="truncate">{a.title}</div>
          <Badge variant="outline">{a.kind}</Badge>
        </li>
      ))}
    </ul>
  );
}

function CampaignLinks({ campaign, onPatch }: { campaign: Campaign; onPatch: (u: Partial<Campaign>) => void }) {
  const [draft, setDraft] = useState("");
  const links = campaign.promo_link_urls || [];
  function add() {
    const v = draft.trim();
    if (!v) return;
    onPatch({ promo_link_urls: [...links, v] as any });
    setDraft("");
  }
  function remove(i: number) {
    onPatch({ promo_link_urls: links.filter((_, idx) => idx !== i) as any });
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="https://jfeffect.com/…" />
        <Button onClick={add}>Add</Button>
      </div>
      {links.length === 0 ? (
        <EmptyHint text="No promo links yet." />
      ) : (
        <ul className="divide-y rounded border">
          {links.map((u, i) => (
            <li key={i} className="flex items-center justify-between gap-2 p-3 text-sm">
              <a href={u} target="_blank" rel="noreferrer" className="truncate text-primary underline">{u}</a>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(u); toast.success("Copied"); }}>Copy</Button>
                <Button size="sm" variant="ghost" onClick={() => remove(i)}>Remove</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {campaign.landing_page_url && (
        <div className="rounded border p-3 text-sm">
          <div className="text-xs uppercase text-muted-foreground">Landing page</div>
          <a href={campaign.landing_page_url} target="_blank" rel="noreferrer" className="text-primary underline">{campaign.landing_page_url}</a>
        </div>
      )}
    </div>
  );
}

function CampaignPerformance({ campaignId }: { campaignId: string }) {
  const { data } = useQuery({
    queryKey: ["campaign_perf", campaignId],
    queryFn: async () => {
      const { data } = await (supabase.from("media_performance_entries") as any)
        .select("*").eq("campaign_id", campaignId).order("publish_date", { ascending: false });
      return data || [];
    },
  });
  if (!data?.length) return <EmptyHint text="No performance entries for this campaign. Add manual results from /media/performance." />;
  const totals = data.reduce((acc: any, r: any) => ({
    views: (acc.views || 0) + (r.views || 0),
    leads: (acc.leads || 0) + (r.leads || 0),
    sales: (acc.sales || 0) + (r.sales || 0),
    revenue: (acc.revenue || 0) + (r.revenue_cents || 0),
  }), {});
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Views" value={totals.views} />
        <Stat label="Leads" value={totals.leads} />
        <Stat label="Sales" value={totals.sales} />
        <Stat label="Revenue" value={Math.round((totals.revenue || 0) / 100)} sub="USD" />
      </div>
      <ul className="divide-y rounded border text-sm">
        {data.map((r: any) => (
          <li key={r.id} className="flex items-center justify-between p-3">
            <div><div className="font-medium">{r.platform}</div><div className="text-xs text-muted-foreground">{r.publish_date || "—"} · {r.source}</div></div>
            <div className="text-xs text-muted-foreground">{r.views ?? 0} views · {r.leads ?? 0} leads · {r.sales ?? 0} sales</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CampaignActivity({ campaign }: { campaign: Campaign }) {
  return (
    <div className="space-y-2 text-sm">
      <div>Created {new Date(campaign.created_at).toLocaleString()}</div>
      {campaign.archived && <div>Archived</div>}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="rounded border border-dashed p-4 text-center text-xs text-muted-foreground">{text}</p>;
}