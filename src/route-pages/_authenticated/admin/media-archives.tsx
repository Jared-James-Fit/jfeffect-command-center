import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * The Media Archive list was retired from the Task Manager (auto-archive is
 * off and it never held anything). Archive settings stay in Settings; old
 * links land on the Task Manager instead of a dead page.
 */
export function MediaArchivesRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/admin/content", search: { tab: "tasks" } as any, replace: true });
  }, [navigate]);
  return null;
}
