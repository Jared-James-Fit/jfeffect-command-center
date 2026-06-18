import { createFileRoute, redirect } from "@tanstack/react-router";
import { isNative } from "@/platform";

// /join is a web-only public funnel entry that redirects to /membership.
// Hide it on native (App Store / Play Store builds) — in-app web checkout
// is not allowed under store policies, so native users go to /app instead.
export const Route = createFileRoute("/join")({
  beforeLoad: ({ search }) => {
    if (isNative()) {
      throw redirect({ to: "/app", replace: true });
    }
    throw redirect({ to: "/membership", search: search as any, replace: true });
  },
  component: () => null,
});
