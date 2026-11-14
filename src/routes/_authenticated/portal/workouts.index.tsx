import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import { portalWorkoutsClientQuery } from "@/lib/portal-page-queries";
import { WorkoutsBodySkeleton } from "@/components/workouts/workouts-skeleton";
import { WorkoutsExperience } from "@/components/workouts/WorkoutsExperience";
import { WorkoutArchiveSection } from "@/components/workout-archive-section";


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
  const { data: client, isLoading } = useQuery({
    ...portalWorkoutsClientQuery(portalUserId ?? ""),
    enabled: !!portalUserId,
  });

  if (isLoading || !client) {
    return (
      <>
        <PageHeader title="Workouts" />
        <WorkoutsBodySkeleton />
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
        footer={<WorkoutArchiveSection clientId={client.id} mode="client" />}
      />
    </>
  );
}