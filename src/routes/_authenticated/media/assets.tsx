import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/_authenticated/media/assets")({
  component: () => {
    const navigate = useNavigate();
    useEffect(() => {
      navigate({ to: "/media/content", search: { tab: "library" } as any, replace: true });
    }, [navigate]);
    return null;
  },
});