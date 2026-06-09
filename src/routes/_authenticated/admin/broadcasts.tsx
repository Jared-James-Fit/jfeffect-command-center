import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Zap, Trash2, Pencil, Megaphone } from "lucide-react";
import { listBroadcastsAdmin, deleteBroadcast, effectiveStatus, statusTone, BROADCAST_AUDIENCE_LABELS, type Broadcast } from "@/lib/broadcasts";
import { BroadcastComposer } from "@/components/broadcast-composer";
import { format } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/broadcasts")({ component: AdminBroadcasts });

function AdminBroadcasts() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("Active");
  const [open, setOpen] = useState(false);
  const [quick, setQuick] = useState(false);
  const [editing, setEditing] = useState<Broadcast | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["admin-broadcasts"],
    queryFn: listBroadcastsAdmin,
  });

  const filtered = useMemo(() => rows.filter((r) => effectiveStatus(r) === tab), [rows, tab]);

  async function onDelete(id: string) {
    if (!confirm("Delete this broadcast?")) return;
    try {
      await deleteBroadcast(id);
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["admin-broadcasts"] });
    } catch (e: any) { toast.error(e.message ?? "Delete failed"); }
  }

  return (
    <>
      <PageHeader
        title="Community Broadcasts"
        subtitle="Send quick messages, quotes, voice notes, videos, and reminders."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setEditing(null); setQuick(true); setOpen(true); }}>
              <Zap className="mr-1 h-4 w-4" /> Quick Broadcast
            </Button>
            <Button onClick={() => { setEditing(null); setQuick(false); setOpen(true); }} className="bg-gradient-primary font-bold">
              <Plus className="mr-1 h-4 w-4" /> New Broadcast
            </Button>
          </div>
        }
      />
      <div className="space-y-4 p-4 md:p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="Active">Active</TabsTrigger>
            <TabsTrigger value="Scheduled">Scheduled</TabsTrigger>
            <TabsTrigger value="Draft">Draft</TabsTrigger>
            <TabsTrigger value="Archived">Archived</TabsTrigger>
          </TabsList>
          <TabsContent value={tab} className="mt-4">
            {isLoading ? (
              <Card className="p-8 text-center text-sm text-muted-foreground">Loading…</Card>
            ) : filtered.length === 0 ? (
              <Card className="p-12 text-center">
                <Megaphone className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">Nothing here yet.</p>
              </Card>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {filtered.map((r) => (
                  <Card key={r.id} className="flex flex-col gap-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-base font-bold">{r.title}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px]">{r.type}</Badge>
                          <Badge variant="outline" className={`text-[10px] ${statusTone(effectiveStatus(r))}`}>{effectiveStatus(r)}</Badge>
                        </div>
                      </div>
                    </div>
                    <p className="line-clamp-3 text-xs text-muted-foreground">{r.body || "—"}</p>
                    <div className="text-[11px] text-muted-foreground">
                      To: {BROADCAST_AUDIENCE_LABELS[r.audience_scope]} · {format(new Date(r.publish_at), "MMM d, h:mm a")}
                    </div>
                    <div className="mt-auto flex gap-2 pt-2">
                      <Button asChild variant="outline" size="sm" className="flex-1">
                        <Link to="/admin/broadcasts/$broadcastId" params={{ broadcastId: r.id } as any}>View</Link>
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => { setEditing(r); setQuick(false); setOpen(true); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => onDelete(r.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <BroadcastComposer
        open={open}
        onOpenChange={setOpen}
        initial={editing}
        quick={quick}
        onSaved={() => qc.invalidateQueries({ queryKey: ["admin-broadcasts"] })}
      />
    </>
  );
}