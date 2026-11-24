import { createFileRoute, redirect } from "@tanstack/react-router";
import { EmptyState, ErrorState, OfflineState, SlowNote } from "@/components/loading";
import { queryView } from "@/lib/loading/load-state";
import { useQuery } from "@tanstack/react-query";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import { portalWorkoutsClientQuery } from "@/lib/portal-page-queries";
import { WorkoutsBodySkeleton } from "@/components/workouts/workouts-skeleton";
import { WorkoutsExperience } from "@/components/workouts/WorkoutsExperience";
import { WorkoutArchiveSection } from "@/components/workout-archive-section";
import { EquipmentIntroGate } from "@/components/equipment/setup-tips";
import { useServiceTier } from "@/lib/service-tier";


export const Route = createFileRoute("/_authenticated/portal/workouts/")({
  // Community used to be a tab here (`#community`, `#community&post=<id>`);
  // links and notifications already sent forward to its own page.
  beforeLoad: ({ location }) => {
    const hash = typeof location.hash === "string" ? location.hash.replace(/^#/, "") : "";
    if (hash.split("&")[0] !== "community") return;
    const post = hash.match(/post=([0-9a-f-]{36})/i)?.[1];
    throw redirect({ to: "/portal/community", hash: post ? `post=${post}` : undefined, replace: true });
  },
  // ?open=<yyyy-mm-dd>: open that day's workout (a coach jumping in from a session).
  // ?days=1: open the training days editor (a program's workouts a week changed).
  validateSearch: (s: Record<string, unknown>): { open?: string; days?: 1 } => ({
    ...(typeof s.open === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.open) ? { open: s.open } : {}),
    ...(s.days === 1 || s.days === "1" ? { days: 1 as const } : {}),
  }),
  component: WorkoutsPage,
});

function WorkoutsPage() {
  const portalUserId = usePortalUserId();
  const { open, days } = Route.useSearch();
  // The client row (one small read, kept on the phone a day and warmed when the
  // app opens: useWarmClientPages) opens the program; until it's known the page
  // keeps its title and shows the schedule's own shape, never a spinner.
  const clientQ = useQuery({
    ...portalWorkoutsClientQuery(portalUserId ?? ""),
    enabled: !!portalUserId,
  });
  const client = clientQ.data;
  const clientState = queryView(clientQ as any).kind;

  if (!client) {
    // waiting keeps the schedule's shape; failed, offline or no account each say so (never a skeleton forever)
    return (
      <>
        <PageHeader title="Workouts" />
        {clientState === "error" ? (
          <div className="px-4 py-6"><ErrorState error={clientQ.error} what="your workouts" onRetry={() => clientQ.refetch()} retrying={clientQ.isFetching} /></div>
        ) : clientState === "offline" ? (
          <div className="px-4 py-6"><OfflineState what="your workouts" /></div>
        ) : clientState === "empty" ? (
          <div className="px-4 py-6"><EmptyState title="No training account yet" detail="Your workouts show here once your account is set up." /></div>
        ) : (
          <>
            <WorkoutsBodySkeleton />
            <SlowNote active onRetry={() => clientQ.refetch()} what="your workouts" />
          </>
        )}
      </>
    );
  }

  return (
    <>
      <WorkoutsExperience
        clientId={client.id}
        mode="self"
        openDate={open ?? null}
        openDays={days === 1}
        footer={<PastPrograms clientId={client.id} />}
      />
      {/* Equipment & setups' one-time walkthrough: here, never inside a workout. */}
      <EquipmentIntroGate clientId={client.id} unit={(client as any).preferred_weight_unit === "kg" ? "kg" : "lb"} />
    </>
  );
}
/**
 * A coaching client's past blocks stay listed at the bottom (their coach
 * manages them). A JF member's past programs are Program history instead,
 * in the ⋯ (resume, start over, remove), so nothing is listed twice.
 */
function PastPrograms({ clientId }: { clientId: string }) {
  const { isSelfServe, loading } = useServiceTier();
  if (loading || isSelfServe) return null;
  return <WorkoutArchiveSection clientId={clientId} mode="client" />;
}
