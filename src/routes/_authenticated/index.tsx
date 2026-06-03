import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/")({
  component: RoleRedirect,
});

function RoleRedirect() {
  const { role, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (loading) return;
    navigate({ to: role === "admin" ? "/admin" : "/portal", replace: true });
  }, [role, loading, navigate]);
  return (
    <div className="grid min-h-screen place-items-center text-muted-foreground">Loading…</div>
  );
}