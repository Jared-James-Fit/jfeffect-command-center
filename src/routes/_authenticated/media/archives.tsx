import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
export const Route = createFileRoute("/_authenticated/media/archives")({
  component: () => {
    const navigate = useNavigate();
    useEffect(() => { navigate({ to: "/media/content", search: { tab: "archive" }, replace: true }); }, [navigate]);
    return null;
  },
});
