import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { CoachPlatformPage } from "@/components/admin/coach-platform/coach-platform-page";

// Coach platform: JF Effect for coaches, the owner's alone (early-access
// waitlist, pricing, launch gates). The server checks the admin on every
// read and write; this only keeps the screen from showing anyone else.
export const Route = createFileRoute("/_authenticated/admin/coach-platform")({
  validateSearch: (s) =>
    z
      .object({
        tab: z.enum(["applications", "pricing", "launch"]).optional(),
        app: z.string().uuid().optional(),
      })
      .catch({})
      .parse(s),
  component: CoachPlatformRoute,
});

function CoachPlatformRoute() {
  const { accountRole, loading } = useAuth();
  const { tab, app } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  if (loading) return <Loader2 className="m-4 h-5 w-5 animate-spin" />;
  if (accountRole !== "admin") {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <PageHeader title="Coach platform" />
        <Card className="p-4 text-[13px] text-muted-foreground">Only the owner can see this page.</Card>
      </div>
    );
  }
  return (
    <CoachPlatformPage
      tab={tab ?? "applications"}
      appId={app}
      onTab={(t) => navigate({ search: (s: any) => ({ ...s, tab: t }), replace: true })}
    />
  );
}
