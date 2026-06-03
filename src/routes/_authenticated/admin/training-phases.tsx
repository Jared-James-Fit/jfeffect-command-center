import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExternalLink, Pencil } from "lucide-react";
import { PhaseDialog } from "@/components/phase-dialog";
import { derivePhase, displayTitle, toneClasses, PHASE_TYPES, type TrainingPhase, type PhaseState } from "@/lib/training-phases";
import { format, parseISO } from "date-fns";

export const Route = createFileRoute("/_authenticated/admin/training-phases")({
  component: TrainingPhasesDashboard,
});

const FILTERS: { value: PhaseState | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "ending-soon", label: "Ending Soon" },
  { value: "due-today", label: "Due Today" },
  { value: "past-due", label: "Past Due" },
  { value: "upcoming", label: "Upcoming" },
  { value: "completed", label: "Completed" },
];

function TrainingPhasesDashboard() {
  const [filter, setFilter] = useState<PhaseState | "all">("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<TrainingPhase | null>(null);
  const [open, setOpen] = useState(false);

  const { data: rows = [] } = useQuery({
    queryKey: ["training-phases"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_phases")
        .select("*, clients(id, full_name)")
        .order("end_date", { ascending: true });
      if (error) throw error;
      return data as Array<TrainingPhase & { clients: { id: string; full_name: string } | null }>;
    },
  });

  const enriched = useMemo(
    () => rows.map((r) => ({ ...r, derived: derivePhase(r) })),
    [rows],
  );

  const filtered = enriched.filter((r) => {
    if (filter !== "all" && r.derived.state !== filter) return false;
    if (typeFilter !== "all" && r.phase_type !== typeFilter) return false;
    if (q && !(r.clients?.full_name ?? "").toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const counts = FILTERS.reduce<Record<string, number>>((acc, f) => {
    acc[f.value] = f.value === "all" ? enriched.length : enriched.filter((r) => r.derived.state === f.value).length;
    return acc;
  }, {});

  return (
    <>
      <PageHeader title="Training Phases" subtitle="Every client's current block at a glance." />
      <div className="space-y-4 p-6 md:p-8">
        <Card className="border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => (
              <Button key={f.value} size="sm" variant={filter === f.value ? "default" : "outline"} onClick={() => setFilter(f.value)}>
                {f.label} <span className="ml-1.5 text-xs opacity-70">{counts[f.value]}</span>
              </Button>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <Input placeholder="Search client…" value={q} onChange={(e) => setQ(e.target.value)} className="w-48" />
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Phase type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All phase types</SelectItem>
                  {PHASE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>

        <Card className="border-border bg-card p-0 overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No phases match this filter.</div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((r) => (
                <div key={r.id} className="grid grid-cols-12 items-center gap-3 px-4 py-3 hover:bg-secondary/30">
                  <div className="col-span-12 md:col-span-3">
                    {r.clients ? (
                      <Link to="/admin/clients/$id" params={{ id: r.clients.id }} className="font-semibold hover:underline">
                        {r.clients.full_name}
                      </Link>
                    ) : <span className="text-muted-foreground">—</span>}
                    <div className="text-xs text-muted-foreground">{displayTitle(r)}</div>
                  </div>
                  <div className="col-span-6 md:col-span-2 text-xs">
                    <div>{r.phase_type}</div>
                    <div className="text-muted-foreground">{format(parseISO(r.start_date), "MMM d")} → {format(parseISO(r.end_date), "MMM d")}</div>
                  </div>
                  <div className="col-span-6 md:col-span-2">
                    <Badge variant="outline" className={toneClasses(r.derived.tone)}>{r.derived.label}</Badge>
                  </div>
                  <div className="col-span-8 md:col-span-3">
                    <div className="flex items-center justify-between text-xs">
                      <span>{r.derived.daysRemaining < 0 ? `${Math.abs(r.derived.daysRemaining)}d over` : `${r.derived.daysRemaining}d / ${r.derived.weeksRemaining}w left`}</span>
                      <span className="text-muted-foreground">{r.derived.percentComplete}%</span>
                    </div>
                    <Progress value={r.derived.percentComplete} className="mt-1 h-1.5" />
                  </div>
                  <div className="col-span-4 md:col-span-2 flex items-center justify-end gap-1">
                    {r.program_link && (
                      <a href={r.program_link} target="_blank" rel="noreferrer">
                        <Button size="icon" variant="ghost" className="h-7 w-7"><ExternalLink className="h-4 w-4" /></Button>
                      </a>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(r); setOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      {editing && (
        <PhaseDialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }} clientId={editing.client_id} phase={editing} />
      )}
    </>
  );
}