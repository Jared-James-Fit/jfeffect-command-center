import { createFileRoute } from "@tanstack/react-router";
import { CoachesPage } from "@/components/coaches/coaches-page";
import { getCoachPlatformPublic, type CoachPlatformPublic } from "@/lib/coach-platform/coach-platform.functions";
import { shareMeta } from "@/lib/share-meta";

// /coaches: JF Effect for coaches (early access). The price comes from the
// owner's published settings (coach_platform_public()), waited on for at
// most 2 s: without it the page states the planned model and no number.
async function platformForPage(): Promise<CoachPlatformPublic> {
  return Promise.race([
    getCoachPlatformPublic(),
    new Promise<CoachPlatformPublic>((resolve) => setTimeout(() => resolve({ pricing: null, registrationOpen: false }), 2000)),
  ]);
}

const DESCRIPTION =
  "Run your coaching business on JF Effect: programs, nutrition, check-ins, film review and messages in one app your clients will use. Early access for independent coaches.";

export const Route = createFileRoute("/coaches/")({
  component: CoachesRoute,
  loader: async () => ({ platform: await platformForPage() }),
  staleTime: 5 * 60_000,
  head: () => ({
    meta: [
      { title: "JF Effect for Coaches | Early Access for Independent Coaches" },
      { name: "description", content: DESCRIPTION },
      ...shareMeta({
        title: "JF Effect for coaches",
        description: "Run your coaching business on JF Effect. Early access for independent coaches.",
        path: "/coaches",
      }),
    ],
    links: [{ rel: "canonical", href: "https://jfeffect.com/coaches" }],
  }),
});

function CoachesRoute() {
  const { platform } = Route.useLoaderData();
  return <CoachesPage pricing={platform.pricing} />;
}
