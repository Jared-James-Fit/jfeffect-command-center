import { createFileRoute } from "@tanstack/react-router";
import { SignupJf } from "@/route-pages/membership";

export const Route = createFileRoute("/membership")({
  component: SignupJf,
  head: () => ({
    meta: [
      { title: "Every Program You Need. One System. | JF Effect Membership" },
      { name: "description", content: "Training for strength, muscle, and fat loss in one app. Open it and follow the plan. Free trial · Cancel anytime." },
      { property: "og:title", content: "Every Program You Need. One System. | JF Effect Membership" },
      { property: "og:description", content: "Training for strength, muscle, and fat loss in one app. Open it and follow the plan. Free trial · Cancel anytime." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://jfeffect.com/membership" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Every Program You Need. One System. | JF Effect Membership" },
      { name: "twitter:description", content: "Training for strength, muscle, and fat loss in one app. Open it and follow the plan. Free trial · Cancel anytime." },
    ],
    links: [{ rel: "canonical", href: "https://jfeffect.com/membership" }],
  }),
});
