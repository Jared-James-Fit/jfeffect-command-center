import { Link } from "@tanstack/react-router";
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
import { PtSessionDialog } from "@/components/pt-session-dialog";
import { SESSION_TYPES, SESSION_STATUSES, statusTone, fmtTimeRange } from "@/lib/pt-sessions";

export function PtCalendarPanel() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [filters, setFilters] = useState({ client: "all", type: "all", status: "all", location: "", from: "", to: "" });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients-min"],
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id, full_name, timezone, default_session_location").eq("archived", false).order("full_name");
      return data ?? [];
    },
  });

  const { data: sessions = [] } = useQuery({
    queryKey: ["pt-sessions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pt_sessions")
        .select("*, clients(id, full_name)")
        .order("session_date", { ascending: true })
        .order("start_time", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => sessions.filter((s) => {
    if (filters.client !== "all" && s.client_id !== filters.client) return false;
    if (filters.type !== "all" && s.session_type !== filters.type) return false;
    if (filters.status !== "all" && s.status !== filters.status) return false;
    if (filters.location && !s.location?.toLowerCase().includes(filters.location.toLowerCase())) return false;
    if (filters.from && s.session_date < filters.from) return false;
    if (filters.to && s.session_date > filters.to) return false;
    return true;
  }), [sessions, filters]);

  return (
    <>
      <PageHeader title="PT Calendar" subtitle="All personal training sessions across clients." actions={
        <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" /> Book Session
        </Button>
      } />
      <div className="p-6 md:p-8 space-y-4">
        <Card className="border-border bg-card p-4 grid gap-3 md:grid-cols-6">
          <Select value={filters.client} onValueChange={(v) => setFilters({ ...filters, client: v })}>
            <SelectTrigger><SelectValue placeholder="Client" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.type} onValueChange={(v) => setFilters({ ...filters, type: v })}>
            <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {SESSION_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v })}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {SESSION_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input placeholder="Location contains…" value={filters.location} onChange={(e) => setFilters({ ...filters, location: e.target.value })} />
          <Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          <Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </Card>

        <Card className="border-border bg-card p-4">
          {filtered.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No sessions match those filters.</div>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((s: any) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className={statusTone(s.status)}>{s.status}</Badge>
                    <div>
                      <div className="text-sm font-semibold">{s.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(s.session_date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · {fmtTimeRange(s.start_time, s.end_time)} · {s.location}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {s.clients && (
                      <Link to="/admin/clients/$id" params={{ id: s.clients.id }} className="text-sm font-semibold text-primary hover:underline">{s.clients.full_name}</Link>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(s); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <PtSessionDialog open={open} onOpenChange={setOpen} clients={clients} initial={editing ?? undefined} />
    </>
  );
}