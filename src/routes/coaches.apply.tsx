import { createFileRoute } from "@tanstack/react-router";
import { CoachApplication } from "@/components/coaches/coach-application";
import { shareMeta } from "@/lib/share-meta";

// /coaches/apply: early access to JF Effect for coaches (coach-platform/apply.ts).
// No account, no business and no charge: a waitlist the owner reads.
export const Route = createFileRoute("/coaches/apply")({
  component: CoachApplication,
  head: () => ({
    meta: [
      { title: "Request Early Access | JF Effect for Coaches" },
      { name: "description", content: "Apply for early access to JF Effect for coaches. About two minutes, free, and no commitment." },
      ...shareMeta({
        title: "JF Effect for coaches, early access",
        description: "Apply in about two minutes. Free, and no commitment.",
        path: "/coaches/apply",
      }),
    ],
    links: [{ rel: "canonical", href: "https://jfeffect.com/coaches/apply" }],
  }),
});
