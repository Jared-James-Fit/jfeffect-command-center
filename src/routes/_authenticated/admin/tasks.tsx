import { createFileRoute } from "@tanstack/react-router";
import { TasksRedirect } from "@/route-pages/_authenticated/admin/tasks";

export const Route = createFileRoute("/_authenticated/admin/tasks")({
  component: TasksRedirect,
});
