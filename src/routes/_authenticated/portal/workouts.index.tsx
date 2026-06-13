import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, FileText, Dumbbell, Loader2, ExternalLink, Video, Calendar as CalendarIcon, History, ListChecks, Sun, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getClientWorkouts } from "@/lib/pl-programs";
import { derivePhase, type TrainingPhase } from "@/lib/training-phases";
import { WorkoutArchiveSection } from "@/components/workout-archive-section";
import { format, parseISO } from "date-fns";
import { TrainingScheduleCard } from "@/components/training-schedule-card";
import { BlockSummaryCard } from "@/components/block-summary-card";
import { BlockWeekColumns } from "@/components/block-week-columns";
import { ClientBlockView } from "@/components/client-block-view";
import { SmartTodayCard } from "@/components/smart-today-card";
import { FaqWidget } from "@/components/faq-widget";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkoutListCard } from "@/components/workout-list-card";
import { ClientPreviousBlocks } from "@/components/client-previous-blocks";
import { WeekScheduleView } from "@/components/week-schedule-view";
import { ProgressComparison } from "@/components/progress-comparison";

export const Route = createFileRoute("/_authenticated/portal/workouts/")({
  validateSearch: (s: Record<string, unknown>) => ({
    view: s.view === "block" || s.view === "day" ? (s.view as "block" | "day") : undefined,
    week: typeof s.week === "string" ? parseInt(s.week, 10) || undefined
      : typeof s.week === "number" ? s.week : undefined,
    day: typeof s.day === "string" && s.day ? s.day : undefined,
  }),
  component: WorkoutsPage,
});

function WorkoutsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
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

  // Treat the latest non-archived block (default ordering from getClientWorkouts)
  // as the current block for the "All Workouts" tab.
  const blockList = [...blockGroups.values()];
  const currentGroup = blockList[blockList.length - 1] ?? null;
  const currentBlockId: string | null = currentGroup?.block?.id ?? null;
  const currentBlockItems = workoutItems.filter((it) => it.block?.id === currentBlockId);

  // Persist Day/Block view preference. ?view= search param wins, then localStorage,
  // then default to "day".
  const STORAGE_KEY = "portal-workouts-view";
  const [viewMode, setViewModeState] = useState<"day" | "block">(() => {
    if (typeof window === "undefined") return "day";
    if (search?.view === "block" || search?.view === "day") return search.view;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === "block" ? "block" : "day";
  });
  useEffect(() => {
    if (search?.view === "block" || search?.view === "day") {
      setViewModeState(search.view);
    }
  }, [search?.view]);
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, viewMode); } catch {}
  }, [viewMode]);
  // Per-view scroll memory, scoped to this client + block + view, session only.
  const scrollKey = (v: "day" | "block") =>
    `workouts-${v}-view-scroll:${client?.id ?? "anon"}:${currentBlockId ?? "none"}`;
  const saveScroll = (v: "day" | "block") => {
    try { sessionStorage.setItem(scrollKey(v), String(window.scrollY)); } catch {}
  };
  const restoreScroll = (v: "day" | "block") => {
    try {
      const raw = sessionStorage.getItem(scrollKey(v));
      if (raw == null) return false;
      const y = parseInt(raw, 10);
      if (Number.isFinite(y)) {
        window.scrollTo({ top: y, behavior: "auto" });
        return true;
      }
    } catch {}
    return false;
  };
  const setViewMode = (v: "day" | "block") => {
    if (v === viewMode) return;
    // Remember where we were in the current view before switching.
    saveScroll(viewMode);
    const prevY = window.scrollY;
    setViewModeState(v);
    // Update URL state without resetting scroll. resetScroll:false is the
    // TanStack Router opt-out for default scroll restoration.
    navigate({
      search: (prev: any) => {
        const next: any = { ...prev, view: v };
        if (v === "day") { delete next.day; }
        return next;
      },
      replace: true,
      resetScroll: false,
    } as any);
    // After the new view renders, restore that view's saved scroll if any,
    // otherwise keep the viewport where it was (no jump to top, no anchor).
    requestAnimationFrame(() => {
      if (!restoreScroll(v)) {
        window.scrollTo({ top: prevY, behavior: "auto" });
      }
    });
  };
  // Open Block from elsewhere passes #client-block-view in the URL. Only then
  // do we scroll to the Block View anchor on mount. Plain ?view=block (e.g.
  // refresh) preserves whatever scroll the browser restores.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (viewMode !== "block") return;
    if (window.location.hash !== "#client-block-view") return;
    requestAnimationFrame(() => {
      document.getElementById("client-block-view")?.scrollIntoView({ behavior: "smooth", block: "start" });
      // Clear the hash so future toggles don't re-scroll.
      try { history.replaceState(null, "", window.location.pathname + window.location.search); } catch {}
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Persist the current view's scroll on unmount / page hide for restoration.
  useEffect(() => {
    const onHide = () => saveScroll(viewMode);
    window.addEventListener("pagehide", onHide);
    return () => {
      onHide();
      window.removeEventListener("pagehide", onHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, client?.id, currentBlockId]);

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
            <Link to="/portal/workouts/analytics">
              <Button variant="outline" size="sm"><Activity className="mr-1 h-4 w-4" /> My Analytics</Button>
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
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex rounded-md border border-border bg-card p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setViewMode("day")}
                  className={cn(
                    "rounded px-3 py-1 font-semibold transition",
                    viewMode === "day" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Day View
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("block")}
                  className={cn(
                    "rounded px-3 py-1 font-semibold transition",
                    viewMode === "block" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Block View
                </button>
              </div>
            </div>

            {viewMode === "block" ? (
              <>
                <div id="client-block-view" className="scroll-mt-24" />
                {currentGroup ? (
                  <ClientBlockView
                    block={currentGroup.block}
                    selectedWeekIndex={search?.week ?? null}
                    selectedDayId={search?.day ?? null}
                    onWeekChange={(idx) => {
                      navigate({
                        search: (prev: any) => ({ ...prev, view: "block", week: idx, day: undefined }),
                        replace: true,
                      });
                    }}
                    onDayChange={(dayId) => {
                      navigate({
                        search: (prev: any) => ({ ...prev, view: "block", day: dayId }),
                        replace: true,
                      });
                    }}
                    mode="client"
                  />
                ) : (
                  <Card className="p-6 text-sm text-muted-foreground">
                    No assigned block.
                  </Card>
                )}
                {client?.id && (
                  <details className="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
                    <summary className="cursor-pointer font-semibold uppercase tracking-wide">Show calendar schedule</summary>
                    <div className="pt-3 space-y-3">
                      <WeekScheduleView clientId={client.id} blockId={currentBlockId} mode="client" />
                      {currentGroup && (
                        <BlockWeekColumns block={currentGroup.block} weeks={[...currentGroup.weeks.values()]} mode="client" />
                      )}
                    </div>
                  </details>
                )}
              </>
            ) : (
              <Tabs defaultValue="today" className="space-y-4">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="today" className="text-xs sm:text-sm"><Sun className="mr-1 h-3.5 w-3.5" /><span className="hidden sm:inline">Today</span><span className="sm:hidden">Today</span></TabsTrigger>
                  <TabsTrigger value="all" className="text-xs sm:text-sm"><ListChecks className="mr-1 h-3.5 w-3.5" /><span className="hidden sm:inline">All Workouts</span><span className="sm:hidden">All</span></TabsTrigger>
                  <TabsTrigger value="calendar" className="text-xs sm:text-sm"><CalendarIcon className="mr-1 h-3.5 w-3.5" /><span className="hidden sm:inline">Calendar</span><span className="sm:hidden">Cal</span></TabsTrigger>
                  <TabsTrigger value="history" className="text-xs sm:text-sm"><History className="mr-1 h-3.5 w-3.5" /><span className="hidden sm:inline">History</span><span className="sm:hidden">Hist</span></TabsTrigger>
                </TabsList>

                <TabsContent value="today" className="space-y-4">
                  {currentGroup ? (
                    <BlockSection block={currentGroup.block} weeks={[...currentGroup.weeks.values()]} />
                  ) : (
                    <Card className="p-6 text-sm text-muted-foreground">No active block.</Card>
                  )}
                </TabsContent>

                <TabsContent value="all" className="space-y-3">
                  {currentBlockItems.length === 0 ? (
                    <Card className="p-6 text-sm text-muted-foreground">No workouts assigned in your current block.</Card>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Every workout in your current block — tap any to start, even if it isn't today.
                      </p>
                      {currentBlockItems.map((it) => (
                        <WorkoutListCard key={it.day.id} item={it} />
                      ))}
                    </>
                  )}
                </TabsContent>

                <TabsContent value="calendar" className="space-y-4">
                  {client?.id && (
                    <>
                      <WeekScheduleView clientId={client.id} blockId={currentBlockId} mode="client" />
                      {currentGroup && (
                        <BlockWeekColumns block={currentGroup.block} weeks={[...currentGroup.weeks.values()]} mode="client" />
                      )}
                    </>
                  )}
                </TabsContent>

                <TabsContent value="history" className="space-y-3">
                  {client?.id && (
                    <>
                      <Card className="p-4">
                        <div className="mb-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">Compare Progress</div>
                        <ProgressComparison clientId={client.id} />
                      </Card>
                      <ClientPreviousBlocks clientId={client.id} mode="client" />
                    </>
                  )}
                </TabsContent>
              </Tabs>
            )}
          </div>
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
  const [fullscreen, setFullscreen] = useState(false);
  // Lock body scroll while in fullscreen overlay so iPad/mobile feel native.
  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [fullscreen]);

  const content = (
    <section className={cn("space-y-3", fullscreen && "h-full overflow-y-auto p-4 md:p-6")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {bannerText && <Badge variant="outline" className="text-[10px]">{bannerText}</Badge>}
          <h2 className="truncate text-base font-black sm:text-lg">
            {block?.name ?? "Training Block"}
          </h2>
        </div>
        <Button
          size="sm"
          variant={fullscreen ? "default" : "outline"}
          onClick={() => setFullscreen((v) => !v)}
          className="h-8"
        >
          {fullscreen ? <><Minimize2 className="mr-1.5 h-3.5 w-3.5" /> Exit Full Screen</> : <><Maximize2 className="mr-1.5 h-3.5 w-3.5" /> Full Screen</>}
        </Button>
      </div>
      {block?.id && <BlockSummaryCard blockId={block.id} mode="client" />}
      <Card className="p-3">
        <div className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Weeks</div>
        <BlockWeekColumns block={block} weeks={weeks} mode="client" />
      </Card>
    </section>
  );

  if (!fullscreen) return content;
  return (
    <div className="fixed inset-0 z-[100] bg-background">
      {content}
    </div>
  );
}