import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
export const Route = createFileRoute("/_authenticated/media/testimonials")({
  component: () => {
    const navigate = useNavigate();
    useEffect(() => { navigate({ to: "/media/content", search: { tab: "testimonials" }, replace: true }); }, [navigate]);
    return null;
  },
});
