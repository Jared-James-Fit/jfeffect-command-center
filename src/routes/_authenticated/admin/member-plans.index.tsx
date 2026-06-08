import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Star, ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useState } from "react";
import {
  listFeaturedPlans, addFeaturedPlan, removeFeaturedItem,
  reorderFeaturedItems, updateFeaturedItem,
} from "@/lib/featured.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/member-plans/")({ component: MemberPlansAdmin });

function MemberPlansAdmin() {
  const [tab, setTab] = useState("all");
  const { data: plans = [] } = useQuery({
    queryKey: ["admin-member-plans"],
    queryFn: async () => (await supabase.from("member_plans").select("*").order("created_at", { ascending: false })).data ?? [],
  });
  const list = (plans as any[]).filter((p) => tab === "all" ? true : p.status === tab);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Plan Library"
        subtitle="Member-facing workout plans. Publish from coaching templates or build from scratch."
        actions={<Link to="/admin/member-plans/new"><Button><Plus className="mr-2 h-4 w-4" />New Plan</Button></Link>}
      />
      <FeaturedPlansManager plans={plans as any[]} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="Draft">Drafts</TabsTrigger>
          <TabsTrigger value="Published">Published</TabsTrigger>
          <TabsTrigger value="Archived">Archived</TabsTrigger>
        </TabsList>
        <TabsContent value={tab}>
          <Card className="mt-3 divide-y">
            {list.length === 0 && <div className="p-6 text-sm text-muted-foreground">Nothing here yet.</div>}
            {list.map((p: any) => (
              <Link key={p.id} to="/admin/member-plans/$planId" params={{ planId: p.id }} className="block p-4 hover:bg-muted/40">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{p.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{p.training_style} · {p.difficulty} · {p.weeks}w/{p.days_per_week}d · access: {p.required_access_level}</div>
                  </div>
                  <Badge variant={p.status === "Published" ? "default" : "secondary"}>{p.status}</Badge>
                </div>
              </Link>
            ))}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FeaturedPlansManager({ plans }: { plans: any[] }) {
  const qc = useQueryClient();
  const fetchFeat = useServerFn(listFeaturedPlans);
  const addFn = useServerFn(addFeaturedPlan);
  const removeFn = useServerFn(removeFeaturedItem);
  const reorderFn = useServerFn(reorderFeaturedItems);
  const updateFn = useServerFn(updateFeaturedItem);
  const [selected, setSelected] = useState("");

  const { data: feat } = useQuery({ queryKey: ["admin-featured-plans"], queryFn: () => fetchFeat() });
  const items: any[] = feat?.items ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-featured-plans"] });

  const featuredIds = new Set(items.map((i) => i.plan_id));
  const publishedAvailable = plans.filter((p) => p.status === "Published" && !featuredIds.has(p.id));

  const move = async (idx: number, dir: -1 | 1) => {
    const next = [...items];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    try {
      await reorderFn({ data: { orderedIds: next.map((i) => i.id) } });
      refresh();
    } catch (e: any) { toast.error(e?.message ?? "Reorder failed"); }
  };

  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Star className="h-4 w-4 text-amber-500" />
          <div className="text-sm font-semibold">Featured Plans</div>
          <span className="text-xs text-muted-foreground">Shown on the member dashboard, in order.</span>
        </div>
        <div className="flex items-center gap-2">
          <select className="h-8 rounded-md border bg-background px-2 text-sm" value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Add a published plan…</option>
            {publishedAvailable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <Button size="sm" disabled={!selected} onClick={async () => {
            try { await addFn({ data: { planId: selected } }); setSelected(""); refresh(); toast.success("Added to featured"); }
            catch (e: any) { toast.error(e?.message ?? "Failed"); }
          }}><Plus className="mr-1 h-3.5 w-3.5" />Add</Button>
        </div>
      </div>
      <div className="divide-y rounded-md border">
        {items.length === 0 && <div className="p-3 text-sm text-muted-foreground">No featured plans yet.</div>}
        {items.map((it, idx) => (
          <div key={it.id} className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{it.member_plans?.name ?? "(deleted)"}</div>
              <div className="text-xs text-muted-foreground">
                #{idx + 1} · {it.member_plans?.required_access_level} · {it.active ? "Active" : "Hidden"}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" onClick={() => move(idx, -1)} disabled={idx === 0}><ArrowUp className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" onClick={() => move(idx, 1)} disabled={idx === items.length - 1}><ArrowDown className="h-4 w-4" /></Button>
              <Button size="sm" variant="outline" onClick={async () => {
                await updateFn({ data: { id: it.id, active: !it.active } }); refresh();
              }}>{it.active ? "Hide" : "Show"}</Button>
              <Button size="icon" variant="ghost" onClick={async () => {
                if (!confirm("Remove from featured?")) return;
                await removeFn({ data: { id: it.id } }); refresh();
              }}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}