import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "JF Effect — Private Coaching OS" },
      { name: "description", content: "Your private hub for coaching, check-ins, training, nutrition, progress, payments, and communication." },
      { property: "og:title", content: "JF Effect — Private Coaching OS" },
      { property: "og:description", content: "Your private hub for coaching, check-ins, training, nutrition, progress, payments, and communication." },
    ],
  }),
  component: IndexRedirect,
});

function IndexRedirect() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (user && role) {
      navigate({ to: role === "admin" ? "/admin" : "/portal", replace: true });
    } else {
      navigate({ to: "/auth", replace: true });
    }
  }, [user, role, loading, navigate]);

  return (
    <div className="grid min-h-screen place-items-center bg-background text-muted-foreground">
      Loading…
    </div>
  );
}
