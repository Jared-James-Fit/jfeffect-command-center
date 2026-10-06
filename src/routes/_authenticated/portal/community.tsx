import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The client community lives inside Workouts (`/portal/workouts#community`).
 * This path stays so older links, toasts and push notifications still land
 * in the right place (a `#post=<id>` is carried over).
 */
export const Route = createFileRoute("/_authenticated/portal/community")({
  beforeLoad: ({ location }) => {
    const hash = typeof location.hash === "string" ? location.hash.replace(/^#/, "") : "";
    const post = hash.match(/post=([0-9a-f-]{36})/i)?.[1];
    throw redirect({ to: "/portal/workouts", hash: post ? `community&post=${post}` : "community", replace: true });
  },
});
