import { createFileRoute, redirect } from "@tanstack/react-router";
import { isNative } from "@/platform";
import { SignupJf } from "./membership";

// /join is a web-only public funnel entry.
// Hide it on native (App Store / Play Store builds) — in-app web checkout
// is not allowed under store policies, so native users go to /app instead.
export const Route = createFileRoute("/join")({
  beforeLoad: () => {
    if (isNative()) {
      throw redirect({ to: "/app", replace: true });
    }
  },
  component: () => <SignupJf floatingHeader />,
  head: () => ({
    meta: [
      { title: "Join JF Effect Membership" },
      { name: "description", content: "Join JF Effect for strength, muscle, and fat loss training in one simple membership." },
      { property: "og:title", content: "Join JF Effect Membership" },
      { property: "og:description", content: "Start your JF Effect membership with programs, demos, tracking, and nutrition support in one place." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://jfeffect.com/join" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Join JF Effect Membership" },
      { name: "twitter:description", content: "Start your JF Effect membership with programs, demos, tracking, and nutrition support in one place." },
    ],
    links: [{ rel: "canonical", href: "https://jfeffect.com/join" }],
  }),
});
