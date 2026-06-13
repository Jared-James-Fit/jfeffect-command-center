import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
export const Route = createFileRoute("/_authenticated/media/announcements")({
  component: () => {
    const navigate = useNavigate();
    useEffect(() => { navigate({ to: "/media/communication", search: { tab: "announcements" }, replace: true }); }, [navigate]);
    return null;
  },
});
