import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, MoreHorizontal, ExternalLink, Pencil, CheckCircle2, Archive, Copy, Trash2 } from "lucide-react";
import { PhaseDialog } from "@/components/phase-dialog";
import { derivePhase, displayTitle, toneClasses, type TrainingPhase } from "@/lib/training-phases";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";

export function TrainingPhasesPanel({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TrainingPhase | null>(null);

  const { data: phases = [] } = useQuery({
    queryKey: ["client-phases", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_phases")
        .select("*")
        .eq("client_id", clientId)
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data as TrainingPhase[];
    },
  });

  const update = async (id: string, patch: Partial<TrainingPhase>) => {
    const { error } = await supabase.from("training_phases").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["client-phases", clientId] });
    qc.invalidateQueries({ queryKey: ["training-phases"] });
    toast.success("Updated");
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this phase?")) return;
    const { error } = await supabase.from("training_phases").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["client-phases", clientId] });
    qc.invalidateQueries({ queryKey: ["training-phases"] });
    toast.success("Deleted");
  };

  const duplicate = async (p: TrainingPhase) => {
    const { id, created_at, updated_at, ...rest } = p;
    void id; void created_at; void updated_at;
    const { error } = await supabase.from("training_phases").insert({ ...rest, title: `${rest.title} (copy)`, status: "Upcoming" });
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["client-phases", clientId] });
    toast.success("Duplicated");
  };

  const active = phases.filter((p) => {
    const d = derivePhase(p);
    return d.state === "active" || d.state === "ending-soon" || d.state === "due-today" || d.state === "past-due";
  });
  const upcoming = phases.filter((p) => derivePhase(p).state === "upcoming");
  const history = phases.filter((p) => ["completed", "archived"].includes(derivePhase(p).state));

  const Section = ({ title, items, empty }: { title: string; items: TrainingPhase[]; empty: string }) => (
    <div className="space-y-2">
      <h4 className="text-xs uppercase tracking-widest text-muted-foreground">{title}</h4>
      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">{empty}</div>
      ) : (
        items.map((p) => {
          const d = derivePhase(p);
          return (
            <div key={p.id} className="rounded-md border border-border bg-secondary/30 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{displayTitle(p)}</span>
                    <Badge variant="outline" className={toneClasses(d.tone)}>{d.label}</Badge>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {p.phase_type} · {format(parseISO(p.start_date), "MMM d")} → {format(parseISO(p.end_date), "MMM d, yyyy")}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => { setEditing(p); setOpen(true); }}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => duplicate(p)}><Copy className="mr-2 h-4 w-4" />Duplicate</DropdownMenuItem>
                    {d.state !== "completed" && (
                      <DropdownMenuItem onClick={() => update(p.id, { status: "Completed" })}><CheckCircle2 className="mr-2 h-4 w-4" />Mark complete</DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => update(p.id, { status: "Archived" })}><Archive className="mr-2 h-4 w-4" />Archive</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onClick={() => remove(p.id)}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 text-xs">
                <Stat label="Week" value={`${d.currentWeek}/${d.totalWeeks}`} />
                <Stat label="Days left" value={d.daysRemaining < 0 ? `${Math.abs(d.daysRemaining)} over` : d.daysRemaining} />
                <Stat label="Weeks left" value={d.weeksRemaining} />
                <Stat label="Progress" value={`${d.percentComplete}%`} />
              </div>
              <Progress value={d.percentComplete} className="mt-2 h-1.5" />
              {(p.training_goal || p.program_link) && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  {p.training_goal && <span className="text-muted-foreground">Goal: {p.training_goal}</span>}
                  {p.program_link && (
                    <a href={p.program_link} target="_blank" rel="noreferrer">
                      <Badge variant="outline" className="cursor-pointer hover:border-primary">Program <ExternalLink className="ml-1 h-3 w-3" /></Badge>
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <Card className="border-border bg-card p-6 md:col-span-3">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Training Phases</h3>
        <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" />Add phase
        </Button>
      </div>
      <div className="space-y-5">
        <Section title="Current" items={active} empty="No active phase." />
        <Section title="Upcoming" items={upcoming} empty="No upcoming phases." />
        <Section title="History" items={history} empty="No completed phases yet." />
      </div>
      <PhaseDialog open={open} onOpenChange={setOpen} clientId={clientId} phase={editing} />
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md bg-background/60 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-bold">{value}</div>
    </div>
  );
}