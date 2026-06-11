import { createFileRoute } from "@tanstack/react-router";
import { TasksPage as SharedTasksPage } from "@/components/tasks/tasks-page";

function MediaTasksRoute() {
  return (
    <SharedTasksPage
      title="Tasks"
      subtitle="Plan, prioritize, and knock out media work."
      storagePrefix="jf-media"
    />
  );
}

export const Route = createFileRoute("/_authenticated/media/action-items")({
  component: MediaTasksRoute,
});
