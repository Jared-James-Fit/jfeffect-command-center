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
      { title: "Join JF Effect Membership | Strength, Muscle & Fat Loss App" },
      { name: "description", content: "Join the JF Effect self-guided membership: structured programs, exercise demos, progress tracking, and nutrition support in one app. Train for strength, muscle, and fat loss from anywhere." },
      { property: "og:title", content: "Join JF Effect Membership | Strength, Muscle & Fat Loss App" },
      { property: "og:description", content: "Structured programs, exercise demos, progress tracking, and nutrition support in one app. Train for strength, muscle, and fat loss from anywhere." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://jfeffect.com/join" },
      { property: "og:site_name", content: "JF Effect" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Join JF Effect Membership | Strength, Muscle & Fat Loss App" },
      { name: "twitter:description", content: "Structured programs, exercise demos, progress tracking, and nutrition support in one app. Train for strength, muscle, and fat loss from anywhere." },
    ],
    links: [{ rel: "canonical", href: "https://jfeffect.com/join" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: "https://jfeffect.com/" },
            { "@type": "ListItem", position: 2, name: "Join Membership", item: "https://jfeffect.com/join" },
          ],
        }),
      },
    ],
  }),
});
