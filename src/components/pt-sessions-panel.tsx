import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, CalendarDays, Pencil, Trash2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { PtSessionDialog } from "./pt-session-dialog";
import { statusTone, fmtTimeRange } from "@/lib/pt-sessions";

export function PtSessionsPanel({ clientId, client }: { clientId: string; client: any }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const { data: sessions = [] } = useQuery({
    queryKey: ["pt-sessions", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pt_sessions")
        .select("*")
        .eq("client_id", clientId)
        .order("session_date", { ascending: false })
        .order("start_time", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const upcoming = sessions.filter((s) => s.status === "Scheduled");
  const completed = sessions.filter((s) => s.status === "Completed").length;
  const cancelled = sessions.filter((s) => s.status === "Cancelled").length;
  const missed = sessions.filter((s) => s.status === "Missed").length;

  const purchased = Number(client?.sessions_purchased ?? 0);
  const used = Number(client?.sessions_used ?? 0);
  const remaining = Math.max(purchased - used, 0);

  const markComplete = async (s: any) => {
    const { error } = await supabase.from("pt_sessions").update({ status: "Completed" }).eq("id", s.id);
    if (error) return toast.error(error.message);
    if (client?.package_tracking_enabled) {
      await supabase.from("clients").update({ sessions_used: (client.sessions_used ?? 0) + 1 }).eq("id", clientId);
      qc.invalidateQueries({ queryKey: ["client", clientId] });
    }
    qc.invalidateQueries({ queryKey: ["pt-sessions", clientId] });
    toast.success("Marked completed");
  };

  const del = async (s: any) => {
    if (!confirm("Delete this session?")) return;
    const { error } = await supabase.from("pt_sessions").delete().eq("id", s.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["pt-sessions", clientId] });
    toast.success("Deleted");
  };

  return (
    <Card className="border-border bg-card p-6 md:col-span-3 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <CalendarDays className="h-4 w-4" /> Personal Training Sessions
        </h3>
        <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" /> Book Session
        </Button>
      </div>

      {client?.package_tracking_enabled && (
        <div className="grid gap-2 sm:grid-cols-5 text-xs">
          <Stat label="Purchased" value={purchased} />
          <Stat label="Used" value={used} />
          <Stat label="Remaining" value={remaining} tone="primary" />
          <Stat label="Upcoming" value={upcoming.length} />
          <Stat label="Completed" value={completed} />
        </div>
      )}
      {!client?.package_tracking_enabled && (
        <div className="grid gap-2 sm:grid-cols-4 text-xs">
          <Stat label="Upcoming" value={upcoming.length} />
          <Stat label="Completed" value={completed} />
          <Stat label="Cancelled" value={cancelled} />
          <Stat label="Missed" value={missed} />
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No sessions booked yet.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="flex items-center gap-3">
                <Badge variant="outline" className={statusTone(s.status)}>{s.status}</Badge>
                <div>
                  <div className="text-sm font-semibold">{s.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(s.session_date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · {fmtTimeRange(s.start_time, s.end_time)} · {s.location}
                  </div>
                </div>
              </div>
              <div className="flex gap-1">
                {s.status === "Scheduled" && (
                  <Button size="sm" variant="ghost" onClick={() => markComplete(s)}><CheckCircle2 className="h-4 w-4" /></Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => { setEditing(s); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => del(s)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <PtSessionDialog open={open} onOpenChange={setOpen} clientId={clientId} clients={client ? [client] : []} initial={editing ?? undefined} />
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "primary" }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${tone === "primary" ? "border-primary/40 bg-primary/10" : "border-border bg-secondary/40"}`}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-lg font-black">{value}</div>
    </div>
  );
}