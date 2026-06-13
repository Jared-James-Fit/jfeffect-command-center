import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/_authenticated/admin/sales/coaching")({
  component: () => {
    const navigate = useNavigate();
    useEffect(() => {
      navigate({ to: "/admin/sales", search: { tab: "sales-pages", sub: "coaching" } as any, replace: true });
    }, [navigate]);
    return null;
  },
});