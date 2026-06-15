import { createFileRoute, redirect } from "@tanstack/react-router";

// Permanent redirect: /join → /membership. Preserves query/search params
// (referral codes, tracking params, ?cancelled=1, etc.).
export const Route = createFileRoute("/join")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/membership", search: search as any, replace: true });
  },
  component: () => null,
});
