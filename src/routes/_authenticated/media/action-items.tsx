import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
export const Route = createFileRoute("/_authenticated/media/action-items")({
  component: () => {
    const navigate = useNavigate();
    useEffect(() => { navigate({ to: "/media/content", search: { tab: "tasks" }, replace: true }); }, [navigate]);
    return null;
  },
});
