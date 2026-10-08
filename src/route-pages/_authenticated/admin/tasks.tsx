import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { TasksPage as SharedTasksPage } from "@/components/tasks/tasks-page";

export function TasksRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/admin/content", search: { tab: "tasks" } as any, replace: true });
  }, [navigate]);
  return null;
}

export function AdminTasksPanel() {
  return <SharedTasksPage storagePrefix="jf" />;
}
