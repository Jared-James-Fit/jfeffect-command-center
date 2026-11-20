import { createFileRoute } from "@tanstack/react-router";
import { MembershipApplication } from "@/components/join/membership-application";
import { shareMeta } from "@/lib/share-meta";

// /join: the free membership application (membership-apply.ts), on the web and
// inside the app alike. No account or payment: Jared approves it, then an
// activation link lets them in.
export const Route = createFileRoute("/join")({
  component: MembershipApplication,
  head: () => ({
    meta: [
      { title: "Join JF Effect Free | Training App, Programs & Crew" },
      {
        name: "description",
        content:
          "Apply for a free JF Effect membership in about a minute: coach-written programs, a training log with PRs and progress, nutrition, and a crew of lifters to train with.",
      },
      ...shareMeta({
        title: "Join JF Effect",
        description: "Programs, a training log and a crew to train with. Free.",
        path: "/join",
      }),
    ],
    links: [{ rel: "canonical", href: "https://jfeffect.com/join" }],
  }),
});
