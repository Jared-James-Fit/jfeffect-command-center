import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
export const Route = createFileRoute("/_authenticated/media/events")({
  component: () => {
    const navigate = useNavigate();
    useEffect(() => { navigate({ to: "/media/calendar", search: { tab: "events" }, replace: true }); }, [navigate]);
    return null;
  },
});
