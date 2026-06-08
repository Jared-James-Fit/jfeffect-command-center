import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Calendar as CalendarIcon, CheckCircle2, Crosshair, Clock, ChevronRight, Archive, Pencil, MoreVertical, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  getBlockSummary,
  setWeekManualComplete,
  archiveBlock,
  markBlockComplete,
  type BlockSummaryWeek,
} from "@/lib/pl-programs";
import { useAuth } from "@/lib/auth";
import { EditBlockDatesDialog } from "@/components/edit-block-dates-dialog";

type Mode = "admin" | "client";

function statusTone(status?: string | null) {
  switch (status) {
    case "Active": return "border-emerald-500/40 bg-emerald-500/10 text-emerald-500";
    case "Completed": return "border-sky-500/40 bg-sky-500/10 text-sky-500";
    case "Draft": return "border-muted-foreground/30 bg-muted/30 text-muted-foreground";
    case "Archived": return "border-amber-500/40 bg-amber-500/10 text-amber-500";
    default: return "";
  }
}
function weekTone(s: BlockSummaryWeek["status"]) {
  switch (s) {
    case "Completed": return "border-emerald-500/40 bg-emerald-500/10 text-emerald-500";
    case "Manually Completed": return "border-sky-500/40 bg-sky-500/10 text-sky-500";
    case "In Progress": return "border-amber-500/40 bg-amber-500/10 text-amber-500";
    default: return "border-muted-foreground/30 bg-muted/30 text-muted-foreground";
  }
}

export function BlockSummaryCard({
  blockId,
  mode,
  onRemove,
}: {
  blockId: string;
  mode: Mode;
  onRemove?: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [datesOpen, setDatesOpen] = useState(false);
  const { data: summary, isLoading } = useQuery({
    queryKey: ["block-summary", blockId],
    queryFn: () => getBlockSummary(blockId),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["block-summary", blockId] });
    qc.invalidateQueries({ queryKey: ["assigned-blocks"] });
    qc.invalidateQueries({ queryKey: ["archived-blocks"] });
    qc.invalidateQueries({ queryKey: ["my-workouts"] });
  };

  if (isLoading || !summary) {
    return <Card className="p-4 text-sm text-muted-foreground">Loading block…</Card>;
  }

  const { block, weeks, total_workouts, completed_workouts, progress_pct, current_week_index } = summary;
  const startStr = block.start_date ? format(parseISO(block.start_date), "MMM d, yyyy") : "—";
  const endStr = block.end_date ? format(parseISO(block.end_date), "MMM d, yyyy") : "—";

  const toBlock =
    mode === "admin"
      ? { to: "/admin/blocks/$blockId" as const, params: { blockId } }
      : { to: "/portal/workouts" as const, params: {} as any };

  return (
    <Card className="p-4 space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link {...toBlock} className="font-bold text-base hover:underline truncate">{block.name}</Link>
            <Badge variant="outline" className={cn("text-[10px]", statusTone(block.status))}>{block.status}</Badge>
            {block.completion_method && (
              <Badge variant="outline" className="text-[10px]">{block.completion_method === "manual" ? "Manually completed" : "Auto completed"}</Badge>
            )}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {block.weeks} weeks{block.training_focus ? ` · ${block.training_focus}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {mode === "admin" && (
            <>
              <Button size="sm" variant="outline" onClick={() => setDatesOpen(true)}>
                <Pencil className="mr-1 h-3 w-3" /> Edit Dates
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={async () => {
                    try { await markBlockComplete(blockId); refresh(); toast.success("Block marked complete"); }
                    catch (e: any) { toast.error(e.message); }
                  }}>
                    <CheckCircle2 className="mr-2 h-4 w-4" /> Mark block complete
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={async () => {
                    try { await archiveBlock(blockId, user?.id ?? null); refresh(); toast.success("Block archived"); }
                    catch (e: any) { toast.error(e.message); }
                  }}>
                    <Archive className="mr-2 h-4 w-4" /> Archive block
                  </DropdownMenuItem>
                  {onRemove && <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onRemove} className="text-destructive focus:text-destructive">
                      <Trash2 className="mr-2 h-4 w-4" /> Remove block
                    </DropdownMenuItem>
                  </>}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 text-xs">
        <Stat label="Start" value={startStr} icon={<CalendarIcon className="h-3 w-3" />} />
        <Stat label="End" value={endStr} icon={<CalendarIcon className="h-3 w-3" />} />
        <Stat label="Current Week" value={current_week_index ? `Week ${current_week_index}` : "—"} icon={<Crosshair className="h-3 w-3" />} />
        <Stat label="Progress" value={`${completed_workouts}/${total_workouts} · ${progress_pct}%`} icon={<CheckCircle2 className="h-3 w-3" />} />
      </div>
      <Progress value={progress_pct} className="h-1.5" />

      {/* Week strip — horizontal */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {weeks.map((w) => {
          const isCurrent = current_week_index === w.week_index;
          const checked = w.status === "Manually Completed";
          return (
            <div
              key={w.id}
              className={cn(
                "min-w-[180px] flex-1 rounded-md border p-2 text-xs",
                isCurrent ? "border-primary/50 bg-primary/5" : "border-border bg-secondary/30",
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="font-bold">Week {w.week_index}</span>
                {isCurrent && <Badge className="h-4 border-primary/40 bg-primary/15 px-1 text-[9px] text-primary">Now</Badge>}
              </div>
              {(w.start_date || w.end_date) && (
                <div className="text-[10px] text-muted-foreground">
                  {w.start_date ? format(parseISO(w.start_date), "MMM d") : "—"}
                  {" – "}
                  {w.end_date ? format(parseISO(w.end_date), "MMM d") : "—"}
                </div>
              )}
              {w.training_days?.length > 0 && (
                <div className="text-[10px] text-muted-foreground truncate">{w.training_days.join(", ")}</div>
              )}
              {w.est_minutes != null && (
                <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                  <Clock className="h-2.5 w-2.5" /> ~{w.est_minutes} min
                </div>
              )}
              <div className="mt-1 flex items-center gap-1">
                <Badge variant="outline" className={cn("text-[9px]", weekTone(w.status))}>{w.status}</Badge>
                <span className="text-[10px] text-muted-foreground">{w.completed_count}/{w.day_count}</span>
              </div>
              <label className="mt-1 flex items-center gap-1 text-[10px] cursor-pointer">
                <Switch
                  checked={checked}
                  onCheckedChange={async (v) => {
                    try {
                      await setWeekManualComplete(w.id, v, user?.id ?? null);
                      refresh();
                      toast.success(v ? "Week marked complete" : "Manual flag removed");
                    } catch (e: any) { toast.error(e.message); }
                  }}
                />
                <span>Mark Week Complete</span>
              </label>
              {w.notes && <p className="mt-1 text-[10px] text-muted-foreground line-clamp-2">{w.notes}</p>}
            </div>
          );
        })}
      </div>

      <div className="flex justify-end">
        <Link {...toBlock}>
          <Button size="sm" variant="ghost">
            Open block <ChevronRight className="ml-1 h-3 w-3" />
          </Button>
        </Link>
      </div>

      {mode === "admin" && (
        <EditBlockDatesDialog
          open={datesOpen}
          onOpenChange={setDatesOpen}
          blockId={blockId}
          initialStart={block.start_date}
          initialEnd={block.end_date}
          weeks={block.weeks}
          weekDurationDays={block.week_duration_days ?? 7}
          onSaved={refresh}
        />
      )}
    </Card>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-secondary/20 p-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground inline-flex items-center gap-1">{icon}{label}</div>
      <div className="text-sm font-semibold truncate">{value}</div>
    </div>
  );
}