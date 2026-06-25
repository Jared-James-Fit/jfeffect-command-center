import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/_authenticated/media/drafts")({
  component: () => {
    const navigate = useNavigate();
    useEffect(() => {
      navigate({ to: "/media/communication", search: { tab: "drafts" } as any, replace: true });
    }, [navigate]);
    return null;
  },
});