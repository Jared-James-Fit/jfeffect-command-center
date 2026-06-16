import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { AuthSplash } from "@/components/auth-splash";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "JF Effect — Private Coaching & Training System" },
      { name: "description", content: "Structured training, nutrition, progress tracking, and private coaching for men who are done starting over." },
      { property: "og:title", content: "JF Effect — Private Coaching & Training System" },
      { property: "og:description", content: "Structured training, nutrition, progress tracking, and private coaching for men who are done starting over." },
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
