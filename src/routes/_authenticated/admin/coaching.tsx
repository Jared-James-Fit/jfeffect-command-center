import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Removed page (Nov 19 2026): the Coaching Hub's tabs each live where the coach
 * already works, and its address only redirects so old links, pushes and
 * bookmarks never 404.
 *   Training Intel, Management → Clients, sorted by what needs attention
 *     (missed workouts, inactive, reviews, programs ending; pain flags are
 *     Messages' red line, upcoming meets the dashboard's Upcoming meets card)
 *   Progress → Forms → Submissions on progress photos & videos
 *   Schedules → Forms → More → Check-in schedules
 *   the old check-in queue → Forms → Submissions
 */
export const Route = createFileRoute("/_authenticated/admin/coaching")({
  beforeLoad: ({ search }) => {
    const tab = (search as Record<string, unknown>)?.tab;
    if (tab === "progress") throw redirect({ to: "/admin/forms", search: { tab: "submissions", kind: "progress" } as any, replace: true });
    if (tab === "schedules") throw redirect({ to: "/admin/forms", search: { tab: "schedules" } as any, replace: true });
    if (tab === "check-ins") throw redirect({ to: "/admin/forms", search: { tab: "submissions" } as any, replace: true });
    throw redirect({ to: "/admin/clients", search: { sort: "attention" }, replace: true });
  },
});
