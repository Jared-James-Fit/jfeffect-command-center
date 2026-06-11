import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { AuthSplash } from "@/components/auth-splash";

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
      const dest =
        role === "client" ? "/portal"
        : role === "member" ? "/m"
        : role === "media_manager" ? "/media"
        : "/admin";
      navigate({ to: dest, replace: true });
    } else {
      navigate({ to: "/auth", replace: true });
    }
  }, [user, role, loading, navigate]);

  return <AuthSplash />;
}
