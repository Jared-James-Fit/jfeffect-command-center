import { createFileRoute, Link } from "@tanstack/react-router";
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

export const Route = createFileRoute("/_authenticated/admin/cardio-targets")({ component: CardioDashboard });

function CardioDashboard() {
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
      <PageHeader title="Cardio Targets" subtitle="All client cardio targets in one place." actions={
        <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" /> Add Cardio
        </Button>
      } />
      <div className="p-6 md:p-8 space-y-4">
        <Card className="border-border bg-card p-4 grid gap-3 md:grid-cols-4">
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
        <Card className="border-border bg-card p-4">
          {rows.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No cardio targets match.</div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((t: any) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <Badge variant="outline" className={t.derived.tone}>{t.derived.label}</Badge>
                    {t.clients && (
                      <Link to="/admin/clients/$id" params={{ id: t.clients.id }} className="text-sm font-semibold text-primary hover:underline">{t.clients.full_name}</Link>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {t.cardio_type === "Custom" ? t.custom_type : t.cardio_type} {t.frequency_per_week ? `· ${t.frequency_per_week}x/wk` : ""} {t.duration_minutes ? `· ${t.duration_minutes} min` : ""} {t.intensity ? `· ${t.intensity}` : ""}
                    </span>
                    <span className="text-xs text-muted-foreground">{t.start_date} → {t.end_date ?? "ongoing"}</span>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(t); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <CardioTargetDialog open={open} onOpenChange={setOpen} clients={clients} initial={editing ?? undefined} />
    </>
  );
}