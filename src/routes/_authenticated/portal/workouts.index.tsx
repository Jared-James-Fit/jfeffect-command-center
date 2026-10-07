import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkoutsExperience } from "@/components/workouts/WorkoutsExperience";
import { WorkoutArchiveSection } from "@/components/workout-archive-section";
import { useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { CommunityScreen } from "@/components/community/community-screen";
import { CLIENT_COMMUNITY_HASH, WorkoutsViewSwitch } from "@/components/community/community-entry";
import { useClientImpersonation } from "@/lib/client-impersonation";


export const Route = createFileRoute("/_authenticated/portal/workouts/")({
  component: WorkoutsPage,
});

type View = "training" | "community";

/** `#community` (optionally `&post=<id>`) opens the Community tab. */
function viewFromHash(): View {
  if (typeof window === "undefined") return "training";
  return window.location.hash.replace(/^#/, "").split("&")[0] === CLIENT_COMMUNITY_HASH ? "community" : "training";
}

function WorkoutsPage() {
  const portalUserId = usePortalUserId();
  const { isImpersonating } = useClientImpersonation();
  // Community lives next to training — same tab, one tap — instead of a
  // separate destination. Training stays the default.
  const [view, setView] = useState<View>(viewFromHash);
  const switchView = (v: View) => {
    setView(v);
    const url = window.location.pathname + window.location.search + (v === "community" ? `#${CLIENT_COMMUNITY_HASH}` : "");
    history.replaceState(history.state, "", url);
    window.scrollTo({ top: 0 });
  };
  const switcher = <WorkoutsViewSwitch view={view} onChange={switchView} />;
  // Resolve the client row first (fast single-row lookup) and render the
  // workouts shell as soon as it's known. The heavier workout-schedule
  // queries fire in parallel from <WorkoutsExperience />, so the page no
  // longer blocks on the full ~6-query getClientWorkouts() chain before
  // showing anything. This is the difference between an instant paint and
  // a multi-second blank/loading state on mobile.
  const { data: client, isLoading } = useQuery({
    queryKey: ["portal-workouts-client", portalUserId],
    enabled: !!portalUserId,
    staleTime: 60_000,
    queryFn: async () =>
      (
        await supabase
          .from("clients")
          .select("id, full_name")
          .eq("user_id", portalUserId!)
          .maybeSingle()
      ).data,
  });

  if (isLoading || !client) {
    return (
      <div className="space-y-4 p-4 md:p-6" aria-busy="true" aria-live="polite">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-64" />
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="space-y-3 p-4">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-20 w-full" />
            </Card>
          ))}
        </div>
        <span className="sr-only">Loading workouts…</span>
      </div>
    );
  }

  if (view === "community") {
    return (
      <>
        <PageHeader title="Workouts" subtitle="What the crew is lifting" />
        <div className="px-4 pt-4 md:px-6">{switcher}</div>
        <CommunityScreen canShare={!isImpersonating} />
      </>
    );
  }

  return (
    <>
      <WorkoutsExperience clientId={client.id} mode="self" topSlot={switcher} />
      <div className="px-4 pb-24 md:px-6">
        <WorkoutArchiveSection clientId={client.id} mode="client" />
      </div>
    </>
  );
}