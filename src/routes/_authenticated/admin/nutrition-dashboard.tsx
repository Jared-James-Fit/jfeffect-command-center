import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Apple, Clock, AlertTriangle, CheckCircle2, Inbox, Pause, MoreVertical, Search } from "lucide-react";
import { toast } from "sonner";
import {
  listNutritionDashboardFn, pushDueDateFn, setNutritionCadenceFn,
  markNotNeededFn, allowResubmitFn,
} from "@/lib/nutrition-updates.functions";

export const Route = createFileRoute("/_authenticated/admin/nutrition-dashboard")({
  component: NutritionDashboard,
});

const STATUS_META: Record<string, { label: string; tone: string }> = {
  overdue: { label: "Overdue", tone: "bg-red-500/15 text-red-400 border-red-500/30" },
  due_today: { label: "Due today", tone: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  due_soon: { label: "Due soon", tone: "bg-amber-500/10 text-amber-300 border-amber-500/20" },
  submitted: { label: "Submitted", tone: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  under_review: { label: "Under review", tone: "bg-blue-500/10 text-blue-300 border-blue-500/20" },
  up_to_date: { label: "Up to date", tone: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  published: { label: "Published", tone: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  paused: { label: "Paused", tone: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30" },
  not_needed: { label: "Not needed", tone: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30" },
};

function fmtDate(d?: string | null) {
  if (!d) return "—";
  try { return new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch { return d; }
}

function NutritionDashboard() {
  const qc = useQueryClient();
  const list = useServerFn(listNutritionDashboardFn);
  const pushDue = useServerFn(pushDueDateFn);
  const setCadence = useServerFn(setNutritionCadenceFn);
  const markNN = useServerFn(markNotNeededFn);
  const allowRe = useServerFn(allowResubmitFn);

  const [filter, setFilter] = useState<"all"|"overdue"|"due_today"|"submitted"|"due_this_week"|"up_to_date"|"paused">("all");
  const [search, setSearch] = useState("");
  const [cadenceDlg, setCadenceDlg] = useState<{ targetId: string; cadence: string; interval?: number | null } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["nutrition-dashboard", filter, search],
    queryFn: () => list({ data: { filter, search } }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["nutrition-dashboard"] });

  const pushM = useMutation({ mutationFn: (v: { targetId: string; days: number }) => pushDue({ data: v }), onSuccess: () => { toast.success("Due date pushed"); invalidate(); } });
  const cadenceM = useMutation({ mutationFn: (v: any) => setCadence({ data: v }), onSuccess: () => { toast.success("Cadence updated"); setCadenceDlg(null); invalidate(); } });
  const markM = useMutation({ mutationFn: (v: { targetId: string }) => markNN({ data: v }), onSuccess: () => { toast.success("Marked not needed"); invalidate(); } });
  const allowM = useMutation({ mutationFn: (v: { clientId: string }) => allowRe({ data: v }), onSuccess: () => { toast.success("Client can submit again"); invalidate(); } });

  const rows = data?.rows ?? [];
  const counts = data?.counts ?? { overdue: 0, due_today: 0, submitted: 0, due_this_week: 0, up_to_date: 0, paused: 0 };

  const tiles = [
    { key: "overdue", label: "Overdue", value: counts.overdue, icon: AlertTriangle, tone: "text-red-400" },
    { key: "due_today", label: "Due today", value: counts.due_today, icon: Clock, tone: "text-amber-400" },
    { key: "submitted", label: "Submitted", value: counts.submitted, icon: Inbox, tone: "text-blue-400" },
    { key: "up_to_date", label: "Up to date", value: counts.up_to_date, icon: CheckCircle2, tone: "text-emerald-400" },
    { key: "paused", label: "Paused", value: counts.paused, icon: Pause, tone: "text-zinc-300" },
  ] as const;

  return (
    <>
      <PageHeader title="Nutrition Dashboard" subtitle="Who is due, overdue, submitted, and handled — at a glance." />
      <div className="p-4 md:p-6 space-y-4 pb-24">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {tiles.map((t) => (
            <button key={t.key} onClick={() => setFilter(t.key as any)} className={`text-left rounded-lg border bg-card p-3 hover:bg-muted/30 transition ${filter === t.key ? "ring-2 ring-primary" : ""}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">{t.label}</span>
                <t.icon className={`h-4 w-4 ${t.tone}`} />
              </div>
              <div className="mt-1 text-2xl font-black">{t.value}</div>
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-2 items-stretch">
          <div className="flex-1 relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search client..." className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
            <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="due_today">Due today</SelectItem>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="due_this_week">Due this week</SelectItem>
              <SelectItem value="up_to_date">Up to date</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" asChild><Link to="/admin/settings/nutrition-automation">Automation</Link></Button>
        </div>

        {isLoading ? (
          <Card className="p-10 text-center text-muted-foreground">Loading…</Card>
        ) : rows.length === 0 ? (
          <Card className="p-10 text-center">
            <Apple className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">No clients match this filter.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {rows.map((r: any) => {
              const ts = r.tracking_status as string;
              const meta = STATUS_META[ts] ?? { label: ts, tone: "" };
              const days = r.nutrition_target_days ?? [];
              const primary = days[0];
              return (
                <Card key={r.id} className="p-3 md:p-4">
                  <div className="flex flex-col md:flex-row md:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link to="/admin/clients/$id" params={{ id: r.client_id }} className="font-bold truncate hover:underline">
                          {r.clients?.full_name ?? "—"}
                        </Link>
                        <Badge variant="outline" className={`text-[10px] ${meta.tone}`}>{meta.label}</Badge>
                        {r.open_submission ? (
                          <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-300 border-blue-500/30">New submission</Badge>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                        <span>Phase: {r.custom_phase || r.phase || "—"}</span>
                        <span>Goal: {r.custom_goal || r.goal || "—"}</span>
                        {primary ? <span>{primary.calories ?? "—"} kcal · P{primary.protein ?? "-"} C{primary.carbs ?? "-"} F{primary.fats ?? "-"}</span> : null}
                        <span>Last: {fmtDate(r.last_updated_date)}</span>
                        <span>Next: {fmtDate(r.next_due_date)}</span>
                        <span>Cadence: {r.update_cadence}</span>
                        {r.clients?.coaches?.name ? <span>Coach: {r.clients.coaches.name}</span> : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.open_submission ? (
                        <Button size="sm" className="font-bold" asChild>
                          <Link to="/admin/nutrition-dashboard/review/$submissionId" params={{ submissionId: r.open_submission.id }}>
                            Review Update
                          </Link>
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" asChild>
                          <Link to="/admin/clients/$id" params={{ id: r.client_id }}>Update Plan</Link>
                        </Button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost"><MoreVertical className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => pushM.mutate({ targetId: r.id, days: 1 })}>Push due +1 day</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => pushM.mutate({ targetId: r.id, days: 3 })}>Push due +3 days</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => pushM.mutate({ targetId: r.id, days: 7 })}>Push due +7 days</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setCadenceDlg({ targetId: r.id, cadence: r.update_cadence, interval: r.cadence_interval_days })}>Change cadence…</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => markM.mutate({ targetId: r.id })}>Mark not needed</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => cadenceM.mutate({ targetId: r.id, cadence: "paused" })}>Pause tracking</DropdownMenuItem>
                          {r.open_submission ? (
                            <DropdownMenuItem onClick={() => allowM.mutate({ clientId: r.client_id })}>Allow resubmit</DropdownMenuItem>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!cadenceDlg} onOpenChange={(o) => !o && setCadenceDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Change cadence</DialogTitle></DialogHeader>
          {cadenceDlg ? (
            <div className="space-y-3">
              <Select value={cadenceDlg.cadence} onValueChange={(v) => setCadenceDlg({ ...cadenceDlg, cadence: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="biweekly">Every 2 weeks</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="custom">Custom interval</SelectItem>
                  <SelectItem value="manual">Manual only</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                </SelectContent>
              </Select>
              {cadenceDlg.cadence === "custom" ? (
                <div>
                  <label className="text-sm font-medium">Interval (days)</label>
                  <Input type="number" min={1} max={365} value={cadenceDlg.interval ?? 7} onChange={(e) => setCadenceDlg({ ...cadenceDlg, interval: Number(e.target.value) })} />
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCadenceDlg(null)}>Cancel</Button>
            <Button onClick={() => cadenceDlg && cadenceM.mutate({ targetId: cadenceDlg.targetId, cadence: cadenceDlg.cadence, cadence_interval_days: cadenceDlg.interval ?? undefined })}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}