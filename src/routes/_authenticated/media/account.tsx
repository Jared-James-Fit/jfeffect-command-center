import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
export const Route = createFileRoute("/_authenticated/media/account")({
  component: () => {
    const navigate = useNavigate();
    useEffect(() => { navigate({ to: "/media/settings", search: { tab: "account" }, replace: true }); }, [navigate]);
    return null;
  },
});
