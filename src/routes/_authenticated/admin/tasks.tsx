import { createFileRoute } from "@tanstack/react-router";
import { TasksPage } from "@/components/tasks/tasks-page";

export const Route = createFileRoute("/_authenticated/admin/tasks")({
  component: () => <TasksPage storagePrefix="jf" />,
});
