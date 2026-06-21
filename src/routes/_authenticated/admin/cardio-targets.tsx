import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil } from "lucide-react";
import { CardioTargetDialog } from "@/components/cardio-target-dialog";
import { CARDIO_TYPES, deriveTarget } from "@/lib/nutrition-cardio";
import { dayTypeLabel, dayTypeTone } from "@/lib/training-schedule";

export const Route = createFileRoute("/_authenticated/admin/cardio-targets")({ component: CardioRedirect });

function CardioRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/admin/programming", search: { tab: "cardio" } as any, replace: true });
  }, [navigate]);
  return null;
}

export function CardioDashboard({ embedded = false }: { embedded?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [filters, setFilters] = useState({ client: "all", type: "all", state: "all", search: "" });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients-min"],
    queryFn: async () => (await supabase.from("clients").select("id, full_name").eq("archived", false).order("full_name")).data ?? [],
  });

  const { data: targets = [] } = useQuery({
    queryKey: ["cardio-targets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cardio_targets")
        .select("*, clients(id, full_name)")
        .order("end_date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = useMemo(() => targets.map((t: any) => ({ ...t, derived: deriveTarget(t) })).filter((t: any) => {
    if (filters.client !== "all" && t.client_id !== filters.client) return false;
    if (filters.type !== "all" && t.cardio_type !== filters.type) return false;
    if (filters.state !== "all" && t.derived.state !== filters.state) return false;
    if (filters.search && !(t.clients?.full_name?.toLowerCase().includes(filters.search.toLowerCase()))) return false;
    return true;
  }), [targets, filters]);

  return (
    <>
      {!embedded && <PageHeader title="Cardio Targets" subtitle="All client cardio targets in one place." actions={
        <Button size="sm" className="bg-gradient-primary font-bold uppercase w-full sm:w-auto" onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" /> Add Cardio
        </Button>
      } />}
      {embedded && (
        <div className="flex justify-end px-3 pt-3 sm:px-6 md:px-8">
          <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Add Cardio
          </Button>
        </div>
      )}
      <div className="p-3 sm:p-6 md:p-8 space-y-4 overflow-x-hidden">
        <Card className="border-border bg-card p-3 sm:p-4 grid gap-3 md:grid-cols-4">
          <Input placeholder="Search client" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
          <Select value={filters.client} onValueChange={(v) => setFilters({ ...filters, client: v })}>
            <SelectTrigger><SelectValue placeholder="Client" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {clients.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.type} onValueChange={(v) => setFilters({ ...filters, type: v })}>
            <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {CARDIO_TYPES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.state} onValueChange={(v) => setFilters({ ...filters, state: v })}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="ending-soon">Ending Soon</SelectItem>
              <SelectItem value="due-today">Due Today</SelectItem>
              <SelectItem value="past-due">Past Due</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </Card>
        <Card className="border-border bg-card p-2 sm:p-4">
          {rows.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No cardio targets match.</div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((t: any) => (
                <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 py-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-3">
                    <Badge variant="outline" className={t.derived.tone}>{t.derived.label}</Badge>
                    <Badge variant="outline" className={dayTypeTone(t.day_type)}>{dayTypeLabel(t)}</Badge>
                    {t.clients && (
                      <Link to="/admin/clients/$id" params={{ id: t.clients.id }} className="truncate text-sm font-semibold text-primary hover:underline">{t.clients.full_name}</Link>
                    )}
                    <span className="w-full text-xs text-muted-foreground sm:w-auto">
                      {t.cardio_type === "Custom" ? t.custom_type : t.cardio_type} {t.frequency_per_week ? `· ${t.frequency_per_week}x/wk` : ""} {t.duration_minutes ? `· ${t.duration_minutes} min` : ""} {t.intensity ? `· ${t.intensity}` : ""}
                    </span>
                    <span className="w-full text-xs text-muted-foreground sm:w-auto">{t.start_date} → {t.end_date ?? "ongoing"}</span>
                  </div>
                  <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => { setEditing(t); setOpen(true); }} aria-label="Edit cardio target"><Pencil className="h-4 w-4" /></Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <CardioComplianceSection />
      </div>
      <CardioTargetDialog open={open} onOpenChange={setOpen} clients={clients} initial={editing ?? undefined} />
    </>
  );
}

function CardioComplianceSection() {
  const today = new Date();
  const start = new Date();
  start.setDate(today.getDate() - 6);
  const startStr = start.toISOString().slice(0, 10);
  const endStr = today.toISOString().slice(0, 10);

  const { data, isLoading } = useQuery({
    queryKey: ["cardio-compliance-7d", startStr, endStr],
    staleTime: 60_000,
    queryFn: async () => {
      // Active targets in window (end_date null or >= today, start_date <= today)
      const { data: targets, error: tErr } = await supabase
        .from("cardio_targets")
        .select("id, client_id, frequency_per_week, start_date, end_date, clients(id, full_name)")
        .lte("start_date", endStr);
      if (tErr) throw tErr;
      const active = (targets ?? []).filter((t: any) => !t.end_date || t.end_date >= endStr);
      const clientIds = Array.from(new Set(active.map((t: any) => t.client_id)));
      if (clientIds.length === 0) return [] as any[];

      const { data: completions, error: cErr } = await supabase
        .from("cardio_completions")
        .select("client_id, completed_date, completed")
        .in("client_id", clientIds)
        .gte("completed_date", startStr)
        .lte("completed_date", endStr)
        .eq("completed", true);
      if (cErr) throw cErr;

      const byClient = new Map<string, { name: string; assigned: number; daysSet: Set<string>; last: string | null }>();
      for (const t of active) {
        const id = t.client_id;
        const prev = byClient.get(id);
        const freq = Math.min(Number(t.frequency_per_week) || 0, 7);
        const assigned = Math.max(prev?.assigned ?? 0, freq);
        byClient.set(id, {
          name: t.clients?.full_name ?? "Unknown",
          assigned: assigned || 7,
          daysSet: prev?.daysSet ?? new Set(),
          last: prev?.last ?? null,
        });
      }
      for (const c of completions ?? []) {
        const entry = byClient.get(c.client_id);
        if (!entry) continue;
        entry.daysSet.add(c.completed_date);
        if (!entry.last || c.completed_date > entry.last) entry.last = c.completed_date;
      }
      const rows = Array.from(byClient.entries()).map(([clientId, v]) => {
        const completedDays = v.daysSet.size;
        const rate = v.assigned > 0 ? completedDays / v.assigned : 0;
        return { clientId, name: v.name, completedDays, assigned: v.assigned, last: v.last, rate };
      });
      rows.sort((a, b) => a.rate - b.rate || a.name.localeCompare(b.name));
      return rows.slice(0, 20);
    },
  });

  return (
    <Card className="border-border bg-card p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide">Recent Compliance</h3>
          <p className="text-xs text-muted-foreground">Last 7 days · lowest compliance first · top 20</p>
        </div>
      </div>
      {isLoading ? (
        <div className="py-6 text-center text-xs text-muted-foreground">Loading…</div>
      ) : !data || data.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">No active cardio targets.</div>
      ) : (
        <ul className="divide-y divide-border">
          {data.map((r: any) => {
            const tone = r.rate < 0.5 ? "text-destructive" : r.rate < 0.85 ? "text-amber-500" : "text-emerald-500";
            return (
              <li key={r.clientId} className="flex items-center justify-between gap-3 py-2">
                <Link to="/admin/clients/$id" params={{ id: r.clientId }} className="truncate text-sm font-semibold text-primary hover:underline">{r.name}</Link>
                <div className="flex shrink-0 items-center gap-3 text-xs">
                  <span className={`font-bold ${tone}`}>{r.completedDays}/{r.assigned} days</span>
                  <span className="text-muted-foreground">{r.last ? `last ${r.last}` : "no logs"}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}