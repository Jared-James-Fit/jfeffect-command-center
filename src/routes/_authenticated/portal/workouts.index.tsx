import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, FileText, Dumbbell, Loader2, ExternalLink, Video } from "lucide-react";
import { getClientWorkouts } from "@/lib/pl-programs";
import { derivePhase, type TrainingPhase } from "@/lib/training-phases";
import { WorkoutArchiveSection } from "@/components/workout-archive-section";
import { format, parseISO } from "date-fns";
import { TrainingScheduleCard } from "@/components/training-schedule-card";
import { BlockSummaryCard } from "@/components/block-summary-card";
import { BlockWeekColumns } from "@/components/block-week-columns";
import { SmartTodayCard } from "@/components/smart-today-card";
import { FaqWidget } from "@/components/faq-widget";

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

  const { data: phases = [] } = useQuery({
    queryKey: ["my-phases", client?.id],
    enabled: !!client?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("training_phases").select("*").eq("client_id", client!.id)
        .order("start_date", { ascending: false });
      return (data ?? []) as TrainingPhase[];
    },
  });
  const activePhase = phases.find((p) => {
    const s = derivePhase(p).state;
    return s === "active" || s === "ending-soon" || s === "due-today";
  }) ?? phases.find((p) => derivePhase(p).state === "upcoming") ?? null;
  const phaseLink = activePhase?.program_link ?? client?.program_sheet_link ?? null;

  const blockGroups = new Map<string, { block: any; weeks: Map<string, { week: any; entries: any[] }> }>();
  for (const it of items as any[]) {
    const bk = it.block?.id ?? "none";
    if (!blockGroups.has(bk)) blockGroups.set(bk, { block: it.block, weeks: new Map() });
    const wk = it.week?.id ?? "none";
    const bg = blockGroups.get(bk)!;
    if (!bg.weeks.has(wk)) bg.weeks.set(wk, { week: it.week, entries: [] });
    if (it.day?.id) bg.weeks.get(wk)!.entries.push(it);
  }
  const workoutItems = (items as any[]).filter((it) => it.day?.id);

  return (
    <>
      <PageHeader title="Workouts" subtitle="Your assigned training" />
      <div className="p-6 md:p-8 space-y-6 pb-32">
        <FaqWidget category="workouts" />
        <FaqWidget category="cardio" />
        {client && <TrainingScheduleCard client={client as any} editable />}

        {/* PRIORITY #1 — Smart Today Card */}
        {client?.id && !isLoading && workoutItems.length > 0 && (
          <SmartTodayCard items={workoutItems} clientId={client.id} />
        )}

        <Card className="border-border bg-card p-6 md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <FileText className="h-8 w-8 text-primary" />
              <div>
                <h2 className="text-xl font-black">Your Training Program</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {phaseLink
                    ? "Opens your program sheet or file — bookmark it on your phone."
                    : "Your coach hasn't linked your program yet. Check back soon."}
                </p>
              </div>
            </div>
            {phaseLink && (
              <a href={phaseLink} target="_blank" rel="noreferrer">
                <Button size="lg" className="bg-gradient-primary font-bold uppercase">
                  Open My Program <ExternalLink className="ml-2 h-4 w-4" />
                </Button>
              </a>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/portal/lift-videos">
              <Button variant="outline" size="sm"><Video className="mr-1 h-4 w-4" /> Upload Lift Video</Button>
            </Link>
            <Link to="/portal/exercises">
              <Button variant="outline" size="sm"><Dumbbell className="mr-1 h-4 w-4" /> Exercise Library</Button>
            </Link>
          </div>
        </Card>

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