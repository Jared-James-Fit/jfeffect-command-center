import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Clock, CheckCircle2, Play, ChevronRight, CalendarRange, Crosshair } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { durationRange, setWeekManualComplete } from "@/lib/pl-programs";
import { useAuth } from "@/lib/auth";
import { weekDisplayRange, formatWeekRange, isCurrentWeek } from "@/lib/block-dates";

type Mode = "admin" | "client";
type WeekEntry = { week: any; entries: { day: any; week: any; block: any; completion: any }[] };

/**
 * Always-open horizontal week columns with workouts visible inside each
 * week. Mobile scrolls horizontally; desktop fits as many columns as fit.
 * Vertical divider between columns. No collapsibles.
 */
export function BlockWeekColumns({
  block, weeks, mode,
}: {
  block: any;
  weeks: WeekEntry[];
  mode: Mode;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["my-workouts"] });
    qc.invalidateQueries({ queryKey: ["block-summary", block?.id] });
    qc.invalidateQueries({ queryKey: ["block-analytics", block?.id] });
  };

  return (
    <div className="-mx-2 overflow-x-auto pb-2">
      <div className="flex min-w-min divide-x divide-border px-2">
        {weeks.map(({ week, entries }) => {
          const range = week ? weekDisplayRange(block, week) : null;
          const now = isCurrentWeek(range);
          const totalMin = entries.reduce((s, it) => s + (it.day.duration_override_min ?? it.day.duration_estimate_min ?? 60), 0);
          const doneCount = entries.filter((it) => it.completion?.completed_at).length;
          const status: string = week?.status ?? "Not Started";
          const manual = !!week?.manually_completed;
          const statusTone =
            status === "Completed" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
            : status === "Manually Completed" ? "border-sky-500/40 bg-sky-500/10 text-sky-500"
            : status === "In Progress" ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
            : "border-muted-foreground/30 bg-muted/30 text-muted-foreground";
          return (
            <div
              key={week?.id ?? Math.random()}
              className={cn(
                "w-[280px] shrink-0 space-y-2 px-3 sm:w-[320px]",
                now && "bg-primary/5",
              )}
            >
              {/* Week header */}
              <div className="space-y-1 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-sm">Week {week?.week_index ?? "—"}</span>
                  {now && (
                    <Badge className="h-5 border-primary/40 bg-primary/15 px-1.5 text-[10px] font-semibold text-primary hover:bg-primary/20">
                      <Crosshair className="mr-1 h-3 w-3" />Current
                    </Badge>
                  )}
                  {week && <Badge variant="outline" className={cn("text-[10px]", statusTone)}>{status}</Badge>}
                </div>
                {range && (
                  <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                    <CalendarRange className="h-3 w-3" />
                    {formatWeekRange(range.start, range.end)}
                  </div>
                )}
                <div className="text-[11px] text-muted-foreground">
                  {entries.length} workout{entries.length === 1 ? "" : "s"}
                  {doneCount > 0 ? ` · ${doneCount} done` : ""}
                  {totalMin ? ` · ~${totalMin} min` : ""}
                </div>
                {week?.training_days?.length > 0 && (
                  <div className="text-[10px] text-muted-foreground truncate">{week.training_days.join(", ")}</div>
                )}
                {week?.notes && <p className="text-[10px] text-muted-foreground line-clamp-2">{week.notes}</p>}
              </div>

              {/* Manual complete toggle */}
              {week && (
                <label className="flex items-center justify-between gap-2 rounded-md border border-border bg-secondary/30 p-2 text-xs cursor-pointer">
                  <span className="font-semibold">Mark Week Complete</span>
                  <Switch
                    checked={manual}
                    onCheckedChange={async (v) => {
                      try {
                        await setWeekManualComplete(week.id, v, user?.id ?? null);
                        refresh();
                        toast.success(v ? "Week marked complete" : "Manual flag removed");
                      } catch (e: any) { toast.error(e.message); }
                    }}
                  />
                </label>
              )}

              {/* Workouts (always open) */}
              <div className="space-y-1.5 pb-2">
                {entries.map((it) => {
                  const inner = (
                    <Card className="p-2 flex items-center justify-between gap-2 cursor-pointer hover:bg-secondary/40 active:bg-secondary/60 transition">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-xs truncate">
                            {it.day.title || `Day ${it.day.day_index}`}
                            {it.day.focus ? <span className="text-muted-foreground font-normal"> — {it.day.focus}</span> : null}
                          </div>
                          <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                            <Clock className="h-2.5 w-2.5" />
                            {durationRange(it.day.duration_override_min ?? it.day.duration_estimate_min ?? 60)}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {it.completion?.completed_at ? (
                            <Badge variant="outline" className="text-green-500 border-green-500/30 bg-green-500/10 text-[9px] px-1">
                              <CheckCircle2 className="mr-0.5 h-2.5 w-2.5" />Done
                            </Badge>
                          ) : it.completion ? (
                            <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-amber-500/10 text-[9px] px-1">
                              In progress
                            </Badge>
                          ) : (
                            <Play className="h-3 w-3 text-primary" />
                          )}
                          <ChevronRight className="h-3 w-3 text-muted-foreground" />
                        </div>
                    </Card>
                  );
                  if (mode === "client") {
                    return (
                      <Link key={it.day.id} to="/portal/workouts/$dayId" params={{ dayId: it.day.id }} className="block">{inner}</Link>
                    );
                  }
                  return (
                    <Link key={it.day.id} to="/admin/blocks/$blockId" params={{ blockId: block?.id }} className="block">{inner}</Link>
                  );
                })}
                {entries.length === 0 && (
                  <p className="text-[11px] text-muted-foreground italic">No workouts in this week.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}