import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, FileText, Dumbbell, ChevronRight, Loader2 } from "lucide-react";
import { getClientWorkouts } from "@/lib/pl-programs";
import { WorkoutArchiveSection } from "@/components/workout-archive-section";
import { format, parseISO } from "date-fns";
import { TrainingScheduleCard } from "@/components/training-schedule-card";
import { BlockSummaryCard } from "@/components/block-summary-card";
import { BlockWeekColumns } from "@/components/block-week-columns";
import { SmartTodayCard } from "@/components/smart-today-card";

export const Route = createFileRoute("/_authenticated/portal/workouts/")({ component: WorkoutsPage });

function WorkoutsPage() {
  const portalUserId = usePortalUserId();
  const { data: client } = useQuery({
    queryKey: ["my-client", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => (await supabase.from("clients").select("*").eq("user_id", portalUserId!).maybeSingle()).data,
  });
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["my-workouts", client?.id],
    enabled: !!client?.id,
    queryFn: () => getClientWorkouts(client!.id),
  });

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
        {/* PRIORITY #1 — Smart Today Card */}
        {client?.id && !isLoading && (items as any[]).length > 0 && (
          <SmartTodayCard items={items as any[]} clientId={client.id} />
        )}

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
          <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading program…
          </Card>
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

        {client && <TrainingScheduleCard client={client as any} editable />}
        {client?.id && <WorkoutArchiveSection clientId={client.id} mode="client" />}
      </div>
    </>
  );
}

function BlockSection({ block, weeks }: { block: any; weeks: { week: any; entries: any[] }[] }) {
  const blockStart = block?.start_date ?? null;
  const blockEnd = block?.end_date ?? null;
  const today = new Date();
  let bannerText: string | null = null;
  if (blockStart) {
    const s = parseISO(blockStart);
    if (today < s) bannerText = `Starts ${format(s, "MMM d, yyyy")}`;
    else if (blockEnd) {
      const e = parseISO(blockEnd);
      if (today > e) bannerText = `Ended ${format(e, "MMM d, yyyy")}`;
    }
  }
  return (
    <section className="space-y-3">
      {bannerText && <Badge variant="outline" className="text-[10px]">{bannerText}</Badge>}
      {block?.id && <BlockSummaryCard blockId={block.id} mode="client" />}
      <Card className="p-3">
        <div className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Weeks</div>
        <BlockWeekColumns block={block} weeks={weeks} mode="client" />
      </Card>
    </section>
  );
}