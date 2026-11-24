import { createFileRoute, Link } from "@tanstack/react-router";
import { SectionErrorBoundary } from "@/components/section-error-boundary";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HardDrive, Check, ChevronDown, Dumbbell } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { format, parseISO } from "date-fns";
import { listClientsDirectoryFn } from "@/lib/clients-directory.functions";
import { ClientNameLink } from "@/components/clients/client-name-link";
import {
  buildSnapshot, waitingOnMe, trainingSummary,
  type InboxRow, type SnapshotTile, type Overview, type OverviewSession,
} from "@/lib/dashboard-feed";
import { DashboardScheduleCard } from "@/components/admin-calendar/dashboard-schedule-card";
import { ChangeRequestsCard } from "@/components/schedule/change-requests-card";
import { UserAvatar } from "@/components/user-avatar";
import { DashboardOfflineEmpty, useIsOfflineWithoutCache } from "@/components/portal/dashboard-offline-empty";
import { NotificationSetupPrompt } from "@/components/notification-setup-prompt";
import { cn } from "@/lib/utils";
import { ErrorState, OfflineState } from "@/components/loading";
import { combineQueryViews, queryView } from "@/lib/loading/load-state";
import { onDashboardClickCapture } from "@/components/return-to-dashboard";
import { NewLeadsCard } from "@/components/leads/new-leads-card";
import { NewApplicationsCard } from "@/components/applications/member-applications-entry";
import { MeetReadinessCard } from "@/components/forms/meet-readiness-card";
import { CompetitionsCard } from "@/components/competition/competitions-card";
import { PainWatchCard } from "@/components/pain/pain-watch-card";
import { RoadmapBoardCard } from "@/components/nutrition-roadmap/roadmap-board-card";
import { CheckinsToReviewCard, useReviewQueue } from "@/components/forms/checkins-to-review-card";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminDashboard,
});

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

function DriveSetupBanner() {
  const { data, isSuccess } = useQuery({
    queryKey: ["media-drive-settings-banner"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("media_drive_settings" as any)
        .select("root_folder_id,status").limit(1).maybeSingle();
      if (error) throw error;
      return data as { root_folder_id?: string | null; status?: string | null } | null;
    },
  });
  const ready = !!data?.root_folder_id && data?.status === "Ready";
  // Only an answer can say Drive isn't set up (a failed read used to claim it wasn't).
  if (ready || !isSuccess) return null;
  // A setup problem: an amber icon on a plain card, not a tinted box.
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2">
        <HardDrive className="h-4 w-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1 truncate text-sm font-medium">
          {data?.root_folder_id ? `Google Drive: ${data?.status ?? "Unknown"}` : "Google Drive not configured"}
        </div>
        <Button asChild size="sm" variant="outline" className="h-9 text-xs"><Link to="/admin/settings">Fix</Link></Button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Snapshot: the six numbers worth seeing every morning               */
/* ------------------------------------------------------------------ */

// Colour only where it means something: red = failing, amber = needs you.
const TILE_TONE: Record<SnapshotTile["tone"], string> = {
  danger: "text-destructive",
  warn: "text-amber-600 dark:text-amber-500",
  info: "text-foreground",
};

/**
 * Only the numbers that have something in them: a zero is nothing to do, so it
 * isn't a tile. With every number at zero the grid is one calm line.
 */
function SnapshotGrid({ tiles, loading, otherWaiting = 0 }: { tiles: SnapshotTile[]; loading: boolean; otherWaiting?: number }) {
  if (loading) {
    return (
      <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2" aria-busy="true">
        {tiles.map((t) => <div key={t.key} className="h-[68px] jf-skeleton rounded-xl border border-border bg-card" />)}
      </div>
    );
  }
  const open = tiles.filter((t) => t.value > 0);
  // Check-ins waiting are their own card above: never "All caught up" under it.
  if (open.length === 0 && otherWaiting > 0) return null;
  if (open.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground" data-dashboard-caught-up>
        <Check className="h-4 w-4 shrink-0 text-success" aria-hidden />
        <span><span className="font-semibold text-foreground">All caught up.</span> No replies, check-ins, payments, agreements or programs waiting on you.</span>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2">
      {open.map((t) => {
        const inner = (
          <div
            title={t.hint}
            className="flex h-full min-h-[68px] flex-col justify-between rounded-xl border border-border bg-card px-3 py-2.5 transition hover:border-foreground/30 active:scale-[0.97]"
          >
            <div className={cn("text-[24px] font-bold leading-none tabular-nums", TILE_TONE[t.tone])}>{t.value}</div>
            <div className="mt-1.5 text-[13px] font-semibold leading-tight text-foreground">{t.label}</div>
            {/* The label says what it is; a second line only when it splits the number ("1 failed · 2 not set up"). */}
            {t.hint.includes(" · ") && <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{t.hint}</div>}
          </div>
        );
        return t.flag ? (
          <Link key={t.key} to="/admin/clients" search={{ flags: t.flag } as any} className="block">{inner}</Link>
        ) : (
          <Link key={t.key} to="/admin/messages" className="block">{inner}</Link>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Overview: what the Clients and Messages pages don't show            */
/* ------------------------------------------------------------------ */

function timeOf(iso: string | null) {
  if (!iso) return null;
  try { return format(parseISO(iso), "h:mm a"); } catch { return null; }
}

// Done and training now are chips; "not yet" is just quiet text.
const STATUS_CHIP: Record<OverviewSession["status"], { label: string; cls: string }> = {
  done: { label: "Done", cls: "rounded-full bg-emerald-500/15 px-2 py-0.5 font-bold text-emerald-600 dark:text-emerald-400" },
  training: { label: "Training now", cls: "rounded-full bg-foreground/10 px-2 py-0.5 font-bold text-foreground" },
  pending: { label: "Not yet", cls: "font-medium text-muted-foreground" },
};

/**
 * Who trains today, as one line: "3 of 8 done" with their faces. The list opens
 * on a tap (the rest one tap away); with nothing scheduled and nobody trained,
 * there's no card at all.
 */
function TrainingTodayCard({ overview, loading }: { overview: Overview | undefined; loading: boolean }) {
  const [open, setOpen] = useState(false);
  const scheduled = overview?.training.scheduled ?? [];
  const extra = overview?.training.unscheduled ?? [];
  const sum = trainingSummary(scheduled, extra.length);
  if (loading) return <div className="h-[60px] jf-skeleton rounded-2xl border border-border bg-card" aria-busy="true" />;
  if (sum.total === 0) return null;
  const faces = [...scheduled, ...extra].slice(0, 4);
  return (
    <Card className="border-border bg-card" data-training-today>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[60px] w-full items-center gap-3 px-4 py-3 text-left"
      >
        <Dumbbell className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">Training today</div>
          <div className="truncate text-[13px] text-muted-foreground">{sum.line}</div>
        </div>
        <div className="flex shrink-0 -space-x-2" aria-hidden>
          {faces.map((f) => (
            <UserAvatar key={`${f.client_id}-${f.title}`} src={f.avatar ?? undefined} name={f.name?.trim() || "Client"} size={26} expandable={false} className="ring-2 ring-card" />
          ))}
        </div>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <ul className="divide-y divide-border border-t border-border px-4">
          {scheduled.map((s) => <TrainingRow key={`${s.client_id}-${s.title}`} s={s} status={s.status} />)}
          {extra.map((s) => <TrainingRow key={`${s.client_id}-${s.title}`} s={s} status="done" />)}
        </ul>
      )}
    </Card>
  );
}

function TrainingRow({ s, status }: { s: Pick<OverviewSession, "client_id" | "name" | "avatar" | "title" | "completed_at">; status: OverviewSession["status"] }) {
  const chip = STATUS_CHIP[status];
  const name = s.name?.trim() || "Client";
  const at = status === "done" ? timeOf(s.completed_at) : null;
  return (
    <li>
      <ClientNameLink clientId={s.client_id} tab="training" className="flex min-h-11 items-center gap-2.5 py-2" ariaLabel={`Open ${name}'s training`}>
        <UserAvatar src={s.avatar ?? undefined} name={name} size={32} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold">{name}</div>
          <div className="truncate text-xs text-muted-foreground">{s.title ?? "Workout"}{at ? ` · ${at}` : ""}</div>
        </div>
        <span className={cn("shrink-0 text-[11px]", chip.cls)}>{chip.label}</span>
      </ClientNameLink>
    </li>
  );
}

function AdminDashboard() {
  const offlineNoCache = useIsOfflineWithoutCache();
  const listDirectory = useServerFn(listClientsDirectoryFn);
  const liveQueueQuery = {
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    refetchOnReconnect: true,
  } as const;

  // The Clients page source: only its roster-wide counts are used here (they're
  // worked out over every client whatever the page size), so it asks for the
  // smallest page instead of 100 rows every minute.
  const directoryQ = useQuery({
    queryKey: ["clients-directory", "dashboard"],
    queryFn: () => listDirectory({ data: { size: 5, sort: "attention", flags: [], page: 1 } as any }),
    ...liveQueueQuery,
  });
  const directory = directoryQ.data;

  // The Messages badge source: who is genuinely waiting on staff.
  const inboxQ = useQuery({
    queryKey: ["staff-inbox-state", "dashboard"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("staff_inbox_state");
      if (error) throw error;
      return (data ?? []) as InboxRow[];
    },
    ...liveQueueQuery,
  });
  const inbox = useMemo(() => inboxQ.data ?? [], [inboxQ.data]);
  const waiting = useMemo(() => waitingOnMe(inbox), [inbox]);
  // The numbers need both reads: waiting on either is loading (never "All caught up"
  // while the replies are still on their way), and a failure is said, never zeros.
  const snapshotState = combineQueryViews([queryView(directoryQ as any), queryView(inboxQ as any)]).kind;
  // Check-ins and forms waiting on review (the card lists them; the same query).
  const { waiting: toReview } = useReviewQueue();

  // Today's training: the one thing here no other page summarises.
  const overviewQ = useQuery({
    queryKey: ["admin-dashboard-overview"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("admin_dashboard_overview");
      if (error) throw error;
      return data as Overview;
    },
    ...liveQueueQuery,
  });
  const overview = overviewQ.data;
  const overviewState = queryView(overviewQ as any).kind;

  const snapshot = useMemo(
    () => buildSnapshot({ waitingReplies: waiting.length, counts: directory?.counts ?? {} }),
    [waiting.length, directory?.counts],
  );

  if (offlineNoCache) return <DashboardOfflineEmpty />;

  return (
    <>
      {/* The date is on the calendar card right under it, so the header is just the title. */}
      <PageHeader title="Today" />

      <div
        onClickCapture={onDashboardClickCapture}
        className="w-full max-w-full space-y-4 overflow-x-hidden p-4 md:p-6"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 6rem)" }}
      >
        {/* ---------------- SCHEDULE first on every Home: change requests (hidden when none), then the next 7 days ---------------- */}
        <SectionErrorBoundary label="Schedule">
          <ChangeRequestsCard />
          <DashboardScheduleCard />
        </SectionErrorBoundary>

        {/* ---------------- CHECK-INS: what clients sent that's waiting on a review (hidden when none) ---------------- */}
        <SectionErrorBoundary label="Check-ins to review">
          <CheckinsToReviewCard />
        </SectionErrorBoundary>

        {/* ---------------- PAIN: clients whose pain wants a look (persistent, worse, severe, limiting; hidden when none) ---------------- */}
        <SectionErrorBoundary label="Pain to look at">
          <PainWatchCard />
        </SectionErrorBoundary>

        {/* ---------------- NUTRITION ROADMAPS: who needs a look, who's on schedule (hidden when none) ---------------- */}
        <SectionErrorBoundary label="Nutrition roadmaps">
          <RoadmapBoardCard />
        </SectionErrorBoundary>

        {/* ---------------- LEADS: new applications waiting on a text (admin; hidden when none) ---------------- */}
        <SectionErrorBoundary label="Leads">
          <NewApplicationsCard />
          <NewLeadsCard />
        </SectionErrorBoundary>

        {/* ---------------- COMPETITIONS: what Cleo prepared and what needs you (hidden when nobody's preparing) ---------------- */}
        <SectionErrorBoundary label="Competitions">
          <CompetitionsCard />
        </SectionErrorBoundary>

        {/* ---------------- MEETS: athletes with a meet checklist out (hidden when none) ---------------- */}
        <SectionErrorBoundary label="Meet readiness">
          <MeetReadinessCard />
        </SectionErrorBoundary>

        <DriveSetupBanner />
        <NotificationSetupPrompt problemsOnly />

        {/* ---------------- SNAPSHOT: tap any number to open that list in Clients / Messages ---------------- */}
        {snapshotState === "error" || snapshotState === "offline" ? (
          snapshotState === "offline"
            ? <OfflineState what="what's waiting on you" size="inline" />
            : <ErrorState
                error={directoryQ.error ?? inboxQ.error}
                what="what's waiting on you"
                size="inline"
                onRetry={() => Promise.all([directoryQ.refetch(), inboxQ.refetch()])}
                retrying={directoryQ.isFetching || inboxQ.isFetching}
              />
        ) : (
          <SnapshotGrid tiles={snapshot} loading={snapshotState === "loading"} otherWaiting={toReview.length} />
        )}

        {/* ---------------- TODAY: who trains today and who already has ---------------- */}
        {overviewState === "error" ? (
          <ErrorState error={overviewQ.error} what="today's training" size="inline" onRetry={() => overviewQ.refetch()} retrying={overviewQ.isFetching} />
        ) : (
          <TrainingTodayCard overview={overview} loading={overviewState === "loading" || overviewState === "offline"} />
        )}
      </div>
    </>
  );
}
