import { createFileRoute } from "@tanstack/react-router";
import { FreeSignup } from "@/components/auth/free-signup";
import { shareMeta } from "@/lib/share-meta";

// /join: a free JF Effect account, on the web and inside the app alike (no
// payment, so nothing for the app stores to object to).
export const Route = createFileRoute("/join")({
  component: FreeSignup,
  head: () => ({
    meta: [
      { title: "Join JF Effect Free | Workout Programs, Training Log & Fitness Community" },
      {
        name: "description",
        content:
          "Make a free JF Effect account: coach-written programs or your own, a training log with PRs and progress, and a crew of lifters to train with.",
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
