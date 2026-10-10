import { createFileRoute } from "@tanstack/react-router";
import { AdminTasksPanel } from "@/route-pages/_authenticated/admin/tasks";

/**
 * The Task Manager. (This page used to also hold a Resource Library and a
 * Media Archive tab; both were retired.) `tab` stays in the URL as "tasks" so
 * the bottom nav's Tasks item stays lit and old ?tab= links still land here.
 */
export const Route = createFileRoute("/_authenticated/admin/content")({
  validateSearch: (_raw: Record<string, unknown>): { tab: "tasks" } => ({ tab: "tasks" }),
  component: AdminTasksPanel,
});
