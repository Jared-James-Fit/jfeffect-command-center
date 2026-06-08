import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adminListResources, adminUpdateResource, adminDeleteResource } from "@/lib/member-resources.functions";
import {
  listFeaturedResources, addFeaturedResource, removeFeaturedItem, reorderFeaturedItems, updateFeaturedItem,
} from "@/lib/featured.functions";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Star, ArrowUp, ArrowDown, Trash2, FileText, Wrench } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/member-resources/")({ component: MemberResourcesAdmin });

function MemberResourcesAdmin() {
  const [tab, setTab] = useState("all");
  const fetchList = useServerFn(adminListResources);
  const updateFn = useServerFn(adminUpdateResource);
  const deleteFn = useServerFn(adminDeleteResource);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["admin-member-resources"], queryFn: () => fetchList() });
  const items: any[] = data?.items ?? [];
  const filtered = items.filter((r) => {
    if (tab === "all") return true;
    if (tab === "Draft" || tab === "Archived") return r.status === tab;
    return r.kind === tab;
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Resources & Tools"
        subtitle="Guides, PDFs, videos, links, and calculators for App Members."
        actions={<Link to="/admin/member-resources/new"><Button><Plus className="mr-2 h-4 w-4" />New</Button></Link>}
      />
      <FeaturedResourcesManager items={items} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="resource">Resources</TabsTrigger>
          <TabsTrigger value="tool">Tools</TabsTrigger>
          <TabsTrigger value="Draft">Drafts</TabsTrigger>
          <TabsTrigger value="Archived">Archived</TabsTrigger>
        </TabsList>
        <TabsContent value={tab}>
          <Card className="mt-3 divide-y">
            {filtered.length === 0 && <div className="p-6 text-sm text-muted-foreground">Nothing here yet.</div>}
            {filtered.map((r) => (
              <div key={r.id} className="flex items-center gap-3 p-4 hover:bg-muted/30">
                <div className="rounded-md border bg-background p-2">
                  {r.kind === "tool" ? <Wrench className="h-4 w-4 text-primary" /> : <FileText className="h-4 w-4 text-primary" />}
                </div>
                <Link to="/admin/member-resources/$resourceId" params={{ resourceId: r.id }} className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{r.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{r.kind} · {r.format} · access: {r.required_access_level}</div>
                </Link>
                <Badge variant={r.status === "Published" ? "default" : "secondary"}>{r.status}</Badge>
                <Button size="sm" variant="outline" onClick={async () => {
                  const next = r.status === "Published" ? "Draft" : "Published";
                  try { await updateFn({ data: { id: r.id, status: next as any } }); qc.invalidateQueries({ queryKey: ["admin-member-resources"] }); toast.success(next); }
                  catch (e: any) { toast.error(e?.message ?? "Failed"); }
                }}>{r.status === "Published" ? "Unpublish" : "Publish"}</Button>
                <Button size="icon" variant="ghost" onClick={async () => {
                  if (!confirm(`Delete "${r.title}"?`)) return;
                  try { await deleteFn({ data: { id: r.id } }); qc.invalidateQueries({ queryKey: ["admin-member-resources"] }); toast.success("Deleted"); }
                  catch (e: any) { toast.error(e?.message ?? "Failed"); }
                }}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FeaturedResourcesManager({ items }: { items: any[] }) {
  const qc = useQueryClient();
  const fetchFeat = useServerFn(listFeaturedResources);
  const addFn = useServerFn(addFeaturedResource);
  const removeFn = useServerFn(removeFeaturedItem);
  const reorderFn = useServerFn(reorderFeaturedItems);
  const updateFn = useServerFn(updateFeaturedItem);
  const [selected, setSelected] = useState("");

  const { data: feat } = useQuery({ queryKey: ["admin-featured-resources"], queryFn: () => fetchFeat() });
  const fitems: any[] = feat?.items ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-featured-resources"] });
  const featuredIds = new Set(fitems.map((i) => i.resource_id));
  const available = items.filter((r) => r.status === "Published" && !featuredIds.has(r.id));

  const move = async (idx: number, dir: -1 | 1) => {
    const next = [...fitems];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    try { await reorderFn({ data: { orderedIds: next.map((i) => i.id) } }); refresh(); }
    catch (e: any) { toast.error(e?.message ?? "Reorder failed"); }
  };

  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Star className="h-4 w-4 text-amber-500" />
          <div className="text-sm font-semibold">Featured Resources</div>
        </div>
        <div className="flex items-center gap-2">
          <select className="h-8 rounded-md border bg-background px-2 text-sm" value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Add a published resource…</option>
            {available.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select>
          <Button size="sm" disabled={!selected} onClick={async () => {
            try { await addFn({ data: { resourceId: selected } }); setSelected(""); refresh(); toast.success("Added"); }
            catch (e: any) { toast.error(e?.message ?? "Failed"); }
          }}><Plus className="mr-1 h-3.5 w-3.5" />Add</Button>
        </div>
      </div>
      <div className="divide-y rounded-md border">
        {fitems.length === 0 && <div className="p-3 text-sm text-muted-foreground">No featured resources yet.</div>}
        {fitems.map((it, idx) => (
          <div key={it.id} className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{it.member_resources?.title ?? "(deleted)"}</div>
              <div className="text-xs text-muted-foreground">
                #{idx + 1} · {it.member_resources?.kind} · {it.active ? "Active" : "Hidden"}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" onClick={() => move(idx, -1)} disabled={idx === 0}><ArrowUp className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" onClick={() => move(idx, 1)} disabled={idx === fitems.length - 1}><ArrowDown className="h-4 w-4" /></Button>
              <Button size="sm" variant="outline" onClick={async () => { await updateFn({ data: { id: it.id, active: !it.active } }); refresh(); }}>
                {it.active ? "Hide" : "Show"}
              </Button>
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