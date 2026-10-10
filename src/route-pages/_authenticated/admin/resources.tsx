import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * The Resource Library tab was retired (it held one test file and nothing
 * used it). Old links land on the Task Manager instead of a dead page.
 */
export function ResourcesRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/admin/content", search: { tab: "tasks" } as any, replace: true });
  }, [navigate]);
  return null;
}
