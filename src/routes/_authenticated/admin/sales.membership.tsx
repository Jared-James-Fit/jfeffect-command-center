import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/_authenticated/admin/sales/membership")({
  component: () => {
    const navigate = useNavigate();
    useEffect(() => {
      navigate({ to: "/admin/sales", search: { tab: "sales-pages", sub: "membership" } as any, replace: true });
    }, [navigate]);
    return null;
  },
});