import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, CheckCircle2, Activity, FileText, Dumbbell, ChevronRight, Play, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getClientWorkouts, durationRange } from "@/lib/pl-programs";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/portal/workouts")({ component: WorkoutsPage });

function WorkoutsPage() {
  const portalUserId = usePortalUserId();
  const { data: client } = useQuery({
    queryKey: ["my-client", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => (await supabase.from("clients").select("id, full_name").eq("user_id", portalUserId!).maybeSingle()).data,
  });
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["my-workouts", client?.id],
    enabled: !!client?.id,
    queryFn: () => getClientWorkouts(client!.id),
  });

  // Group: block → week → days (ordered)
  const blockGroups = new Map<string, { block: any; weeks: Map<string, { week: any; entries: any[] }> }>();
  for (const it of items as any[]) {
    const bk = it.block?.id ?? "none";
    if (!blockGroups.has(bk)) blockGroups.set(bk, { block: it.block, weeks: new Map() });
    const wk = it.week?.id ?? "none";
    const bg = blockGroups.get(bk)!;
    if (!bg.weeks.has(wk)) bg.weeks.set(wk, { week: it.week, entries: [] });
    bg.weeks.get(wk)!.entries.push(it);
  }

  return (
    <>
      <PageHeader title="Workouts" subtitle="Your assigned training" />
      <div className="p-6 md:p-8 space-y-6 pb-32">
        <div className="grid gap-2 sm:grid-cols-2">
          <Link to="/portal/program">
            <Card className="flex items-center justify-between p-3 hover:bg-secondary/30">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-primary" />
                <div>
                  <div className="text-sm font-bold">My Program</div>
                  <div className="text-[11px] text-muted-foreground">Current phase, prep & program sheet</div>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Card>
          </Link>
          <Link to="/portal/exercises">
            <Card className="flex items-center justify-between p-3 hover:bg-secondary/30">
              <div className="flex items-center gap-3">
                <Dumbbell className="h-5 w-5 text-primary" />
                <div>
                  <div className="text-sm font-bold">Exercise Library</div>
                  <div className="text-[11px] text-muted-foreground">Demos & technique videos</div>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Card>
          </Link>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : blockGroups.size === 0 ? (
          <Card className="p-10 text-center">
            <Activity className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">No workouts assigned yet. Your coach will publish your block soon.</p>
          </Card>
        ) : (
          [...blockGroups.values()].map(({ block, weeks }) => (
            <BlockSection key={block?.id ?? "none"} block={block} weeks={[...weeks.values()]} />
          ))
        )}
      </div>
    </>
  );
}

function BlockSection({ block, weeks }: { block: any; weeks: { week: any; entries: any[] }[] }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-muted-foreground">
        {block?.name ?? "Workouts"}
      </h2>
      <div className="space-y-3">
        {weeks.map((w, i) => (
          <WeekSection key={w.week?.id ?? `w-${i}`} week={w.week} entries={w.entries} defaultOpen={i === 0} />
        ))}
      </div>
    </section>
  );
}

function WeekSection({ week, entries, defaultOpen }: { week: any; entries: any[]; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const totalMin = entries.reduce((s, it) => s + (it.day.duration_override_min ?? it.day.duration_estimate_min ?? 60), 0);
  const doneCount = entries.filter((it) => it.completion?.completed_at).length;
  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-secondary/30"
      >
        <div className="min-w-0">
          <div className="font-bold">Week {week?.week_index ?? "—"}</div>
          <div className="text-[11px] text-muted-foreground">
            {entries.length} workout{entries.length === 1 ? "" : "s"}
            {doneCount > 0 ? ` · ${doneCount} done` : ""}
            {totalMin ? ` · ~${totalMin} min total` : ""}
          </div>
        </div>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="grid gap-2 border-t border-border p-2">
          {entries.map((it) => (
            <Link
              key={it.day.id}
              to="/portal/workouts/$dayId"
              params={{ dayId: it.day.id }}
              className="block"
            >
              <Card className="p-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-secondary/40 active:bg-secondary/60 transition">
                <div className="min-w-0 flex-1">
                  <div className="font-bold truncate">
                    {it.day.title || `Day ${it.day.day_index}`}
                    {it.day.focus ? <span className="text-muted-foreground font-normal"> — {it.day.focus}</span> : null}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Week {it.week?.week_index} · <Clock className="inline h-3 w-3 -mt-0.5" />{" "}
                    {durationRange(it.day.duration_override_min ?? it.day.duration_estimate_min ?? 60)}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {it.completion?.completed_at ? (
                    <Badge variant="outline" className="text-green-500 border-green-500/30 bg-green-500/10">
                      <CheckCircle2 className="mr-1 h-3 w-3" /> Done
                    </Badge>
                  ) : it.completion ? (
                    <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-amber-500/10">
                      In progress
                    </Badge>
                  ) : (
                    <Button size="sm" className="h-8" tabIndex={-1}>
                      <Play className="mr-1 h-3.5 w-3.5" /> Open
                    </Button>
                  )}
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}