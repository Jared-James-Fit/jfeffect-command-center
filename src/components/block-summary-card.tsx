import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckCircle2, ChevronRight, Archive, Pencil, MoreVertical, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  getBlockSummary,
  archiveBlock,
  markBlockComplete,
} from "@/lib/pl-programs";
import { useAuth } from "@/lib/auth";
import { EditBlockDatesDialog } from "@/components/edit-block-dates-dialog";

type Mode = "admin" | "client";

function statusTone(status?: string | null) {
  switch (status) {
    case "Active": return "border-emerald-500/40 bg-emerald-500/10 text-emerald-500";
    case "Complete":
    case "Completed": return "border-sky-500/40 bg-sky-500/10 text-sky-500";
    case "Upcoming":
    case "Draft": return "border-muted-foreground/30 bg-muted/30 text-muted-foreground";
    case "Archived": return "border-amber-500/40 bg-amber-500/10 text-amber-500";
    default: return "";
  }
}

export function BlockSummaryCard({
  blockId,
  mode,
  onRemove,
  selected,
  onToggleSelect,
}: {
  blockId: string;
  mode: Mode;
  onRemove?: () => void;
  selected?: boolean;
  onToggleSelect?: () => void;
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
  const startStr = block.start_date ? format(parseISO(block.start_date), "MMM d") : null;
  const endStr = block.end_date ? format(parseISO(block.end_date), "MMM d, yyyy") : null;
  const completedWeeks = weeks.filter((w) => w.status === "Completed" || w.status === "Manually Completed").length;
  const totalWeeks = weeks.length || block.weeks || 0;
  const remaining = Math.max(0, total_workouts - completed_workouts);
  const displayStatus =
    block.status === "Completed" ? "Complete" :
    block.status === "Draft" ? "Upcoming" :
    block.status ?? "—";

  const endPassed =
    !!block.end_date &&
    block.status !== "Archived" &&
    block.status !== "Completed" &&
    parseISO(block.end_date).getTime() < Date.now();

  const toBlock =
    mode === "admin"
      ? { to: "/admin/blocks/$blockId" as const, params: { blockId } }
      : { to: "/portal/workouts" as const, params: {} as any };

  return (
    <Card className="p-4 space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex items-start gap-2">
          {mode === "admin" && onToggleSelect && (
            <Checkbox
              checked={!!selected}
              onCheckedChange={onToggleSelect}
              className="mt-1"
              aria-label="Select block"
            />
          )}
          <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link {...toBlock} className="font-bold text-base hover:underline truncate">{block.name}</Link>
            <Badge variant="outline" className={cn("text-[10px]", statusTone(block.status))}>{displayStatus}</Badge>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {totalWeeks} Weeks
            {block.training_focus ? ` · ${block.training_focus}` : ""}
            {startStr && endStr ? ` · ${startStr} – ${endStr}` : ""}
          </div>
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

      {mode === "admin" && endPassed && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-600">
          <span>End date has passed. Archive this block?</span>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={async () => {
              try { await markBlockComplete(blockId); refresh(); toast.success("Marked complete"); }
              catch (e: any) { toast.error(e.message); }
            }}>Mark complete</Button>
            <Button size="sm" onClick={async () => {
              try { await archiveBlock(blockId, user?.id ?? null); refresh(); toast.success("Block archived"); }
              catch (e: any) { toast.error(e.message); }
            }}><Archive className="mr-1 h-3 w-3" /> Archive now</Button>
          </div>
        </div>
      )}

      {/* Summary stats — human readable, no duplicates */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 text-xs">
        <Stat label="Current Week" value={current_week_index ? `Week ${current_week_index} of ${totalWeeks}` : "—"} />
        <Stat label="Weeks Complete" value={`${completedWeeks} of ${totalWeeks}`} />
        <Stat label="Workouts Complete" value={`${completed_workouts} of ${total_workouts}`} />
      </div>
      <div className="space-y-1">
        <Progress value={progress_pct} className="h-1.5" />
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{progress_pct}% Complete</span>
          <span>{remaining === 0 ? "All workouts complete" : `${remaining} Workout${remaining === 1 ? "" : "s"} Remaining`}</span>
        </div>
      </div>

      <div className="flex justify-end">
        <Link {...toBlock}>
          <Button size="sm" variant="outline">
            <CheckCircle2 className="mr-1 h-3 w-3" /> Open Block <ChevronRight className="ml-1 h-3 w-3" />
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