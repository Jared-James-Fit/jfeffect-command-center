import { createFileRoute } from "@tanstack/react-router";
import { SignupJf } from "@/route-pages/membership";
import { shareMeta } from "@/lib/share-meta";

export const Route = createFileRoute("/membership")({
  component: SignupJf,
  head: () => ({
    meta: [
      { title: "Every Program You Need. One System. | JF Effect Membership" },
      { name: "description", content: "Training for strength, muscle, and fat loss in one app. Open it and follow the plan. Free trial · Cancel anytime." },
      ...shareMeta({
        title: "JF Effect Membership",
        description: "Training for strength, muscle, and fat loss in one app. Open it and follow the plan. Free trial · Cancel anytime.",
        path: "/membership",
      }),
    ],
    links: [{ rel: "canonical", href: "https://jfeffect.com/membership" }],
  }),
});
