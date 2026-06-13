import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
// Phase 4A — Announcements no longer exists as a separate concept (the data
// model couldn't distinguish it from broadcast drafts). Redirect legacy
// /media/announcements links to the single remaining drafts view.
export const Route = createFileRoute("/_authenticated/media/announcements")({
  component: () => {
    const navigate = useNavigate();
    useEffect(() => {
      navigate({ to: "/media/communication", search: { tab: "drafts" }, replace: true });
    }, [navigate]);
    return null;
  },
});
