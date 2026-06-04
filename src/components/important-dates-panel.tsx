import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, MoreHorizontal, ExternalLink, Pencil, CheckCircle2, Archive, Trash2 } from "lucide-react";
import { ImportantDateDialog } from "@/components/important-date-dialog";
import { deriveImportantDate, dateTypeLabel, importantToneClasses, type ImportantDate } from "@/lib/important-dates";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";

export function ImportantDatesPanel({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ImportantDate | null>(null);

  const { data: dates = [] } = useQuery({
    queryKey: ["client-important-dates", clientId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("important_dates") as any)
        .select("*").eq("client_id", clientId).order("target_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ImportantDate[];
    },
  });

  const update = async (id: string, patch: Partial<ImportantDate>) => {
    const { error } = await (supabase.from("important_dates") as any).update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["client-important-dates", clientId] });
    qc.invalidateQueries({ queryKey: ["important-dates"] });
    toast.success("Updated");
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this important date?")) return;
    const { error } = await (supabase.from("important_dates") as any).delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["client-important-dates", clientId] });
    toast.success("Deleted");
  };

  const upcoming = dates.filter((d) => !["completed", "archived"].includes(deriveImportantDate(d).state));
  const history = dates.filter((d) => ["completed", "archived"].includes(deriveImportantDate(d).state));

  const Section = ({ title, items, empty }: { title: string; items: ImportantDate[]; empty: string }) => (
    <div className="space-y-2">
      <h4 className="text-xs uppercase tracking-widest text-muted-foreground">{title}</h4>
      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">{empty}</div>
      ) : (
        items.map((d) => {
          const der = deriveImportantDate(d);
          return (
            <div key={d.id} className="rounded-md border border-border bg-secondary/30 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{d.title}</span>
                    <Badge variant="outline" className={importantToneClasses(der.tone)}>{der.label}</Badge>
                    <Badge variant="outline" className="text-[10px]">{dateTypeLabel(d)}</Badge>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Target: {format(parseISO(d.target_date), "MMM d, yyyy")}
                    {d.start_date && ` · Start: ${format(parseISO(d.start_date), "MMM d, yyyy")}`}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => { setEditing(d); setOpen(true); }}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
                    {der.state !== "completed" && (
                      <DropdownMenuItem onClick={() => update(d.id, { status: "Completed" })}><CheckCircle2 className="mr-2 h-4 w-4" />Mark complete</DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => update(d.id, { status: "Archived" })}><Archive className="mr-2 h-4 w-4" />Archive</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onClick={() => remove(d.id)}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 text-xs">
                <Stat label="Days until" value={der.daysRemaining < 0 ? `${Math.abs(der.daysRemaining)}d past` : `${der.daysRemaining}d`} />
                <Stat label="Weeks left" value={String(der.weeksRemaining)} />
                {der.currentWeek != null && der.totalWeeks != null && <Stat label="Week" value={`${der.currentWeek}/${der.totalWeeks}`} />}
                {der.percentComplete != null && <Stat label="Progress" value={`${der.percentComplete}%`} />}
              </div>
              {der.percentComplete != null && <Progress value={der.percentComplete} className="mt-2 h-1.5" />}
              {d.notes && <div className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap">{d.notes}</div>}
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                <Badge
                  variant="outline"
                  className={d.visible_to_client === false
                    ? "border-warning/40 text-warning bg-warning/10"
                    : "border-success/40 text-success bg-success/10"}
                >
                  Visible to client: {d.visible_to_client === false ? "No" : "Yes"}
                </Badge>
                {d.program_link && (
                  <a href={d.program_link} target="_blank" rel="noreferrer">
                    <Badge variant="outline" className="cursor-pointer hover:border-primary">Program <ExternalLink className="ml-1 h-3 w-3" /></Badge>
                  </a>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <Card className="border-border bg-card p-6 md:col-span-3">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Important Dates / Long-Term Countdown</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">Track competitions, meets, photoshoots, deadlines, and prep timelines.</p>
        </div>
        <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" />Add date
        </Button>
      </div>
      <div className="space-y-5">
        <Section title="Upcoming" items={upcoming} empty="No important dates yet." />
        <Section title="History" items={history} empty="No completed or archived dates." />
      </div>
      <ImportantDateDialog open={open} onOpenChange={setOpen} clientId={clientId} date={editing} />
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