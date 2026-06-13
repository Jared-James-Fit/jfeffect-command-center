import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
export const Route = createFileRoute("/_authenticated/media/uploads")({
  component: () => {
    const navigate = useNavigate();
    useEffect(() => { navigate({ to: "/media/content", search: { tab: "library" }, replace: true }); }, [navigate]);
    return null;
  },
});
