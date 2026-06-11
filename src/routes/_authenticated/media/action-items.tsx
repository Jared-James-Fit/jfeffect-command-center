import { createFileRoute } from "@tanstack/react-router";
import { TasksPage } from "@/components/tasks/tasks-page";

export const Route = createFileRoute("/_authenticated/media/action-items")({
  component: () => (
    <TasksPage
      title="Tasks"
      subtitle="Plan, prioritize, and knock out media work."
      storagePrefix="jf-media"
    />
  ),
});
