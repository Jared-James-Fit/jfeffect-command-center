import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Smartphone, LogIn, Download, Loader2 } from "lucide-react";
import { isStandalone, isNative } from "@/platform";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "Open JF Effect" },
      {
        name: "description",
        content: "Open the JF Effect app — sign in to continue your training, nutrition, and coaching.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Open JF Effect" },
      { property: "og:description", content: "Open the JF Effect app." },
    ],
  }),
  component: AppEntry,
});

function AppEntry() {
  const navigate = useNavigate();
  const [state, setState] = useState<"loading" | "guest">("loading");

  useEffect(() => {
    let cancelled = false;

    async function route() {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!session?.user) {
        setState("guest");
        return;
      }
      // Resolve role → destination.
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id);
      if (cancelled) return;
      const roles = (roleRows ?? []).map((r: any) => r.role as string);
      const dest =
        roles.includes("admin") ? "/admin"
        : roles.includes("coach") ? "/coach"
        : "/m/welcome";
      navigate({ to: dest, replace: true });
    }

    void route();
    return () => { cancelled = true; };
  }, [navigate]);

  if (state === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const installed = isStandalone() || isNative();

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto flex max-w-md flex-col gap-6">
        <header className="space-y-2 text-center">
          <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Smartphone className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Open JF Effect
          </h1>
          <p className="text-sm text-muted-foreground">
            Sign in to continue your training, check-ins, and coaching chat.
          </p>
        </header>

        <Card className="space-y-3 p-5">
          <Button asChild className="w-full" size="lg">
            <Link to="/auth">
              <LogIn className="mr-2 h-4 w-4" />
              Sign in
            </Link>
          </Button>
          <Button asChild variant="outline" className="w-full" size="lg">
            <Link to="/membership">Become a member</Link>
          </Button>
        </Card>

        {!installed && (
          <Card className="space-y-3 p-5">
            <div className="flex items-center gap-2">
              <Download className="h-4 w-4 text-foreground" />
              <h2 className="font-semibold text-foreground">Install the app</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Add JF Effect to your home screen for the full app experience —
              push notifications, offline drafts, and one-tap launch.
            </p>
            <Button asChild variant="secondary" className="w-full">
              <Link to="/install">Install on your phone</Link>
            </Button>
          </Card>
        )}

        <div className="text-center text-xs text-muted-foreground">
          <Link to="/" className="underline">Back to home</Link>
        </div>
      </div>
    </div>
  );
}
