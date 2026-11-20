import { createFileRoute, redirect } from "@tanstack/react-router";

// Retired Nov 20 2026: JF Effect markets online coaching only. In-person
// sessions are still booked and run as before (booking types, PT sessions);
// only this public page is gone, and old links land on online coaching. Its
// /apply child is redirected here too (a parent's beforeLoad runs first), to
// the online application with its ?from= kept.
export const Route = createFileRoute("/personal-trainer-selkirk")({
  beforeLoad: ({ location }) => {
    if (/\/apply\/?$/.test(location.pathname)) {
      throw redirect({ to: "/coaching/apply", search: location.search as any, replace: true });
    }
    throw redirect({ to: "/coaching", replace: true });
  },
  head: () => ({
    links: [{ rel: "canonical", href: "https://jfeffect.com/coaching" }],
  }),
  component: () => null,
});
