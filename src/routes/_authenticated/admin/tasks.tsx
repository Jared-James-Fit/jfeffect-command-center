import { createFileRoute } from "@tanstack/react-router";
import { TasksPage as SharedTasksPage } from "@/components/tasks/tasks-page";

function AdminTasksRoute() {
  return <SharedTasksPage storagePrefix="jf" />;
}

export const Route = createFileRoute("/_authenticated/admin/tasks")({
  component: AdminTasksRoute,
});
