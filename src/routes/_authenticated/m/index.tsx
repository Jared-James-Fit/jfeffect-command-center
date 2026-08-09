import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getCurrentMember } from "@/lib/members.functions";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Settings, ChevronRight } from "lucide-react";
import { SetupChecklist } from "@/components/member/setup-checklist-card";
import { ProgressSummaryCard } from "@/components/progress/progress-summary-card";
import { HomeWaterCard } from "@/components/home/home-water-card";
import { HomeBodyweightCard } from "@/components/home/home-bodyweight-card";
import { DashboardRefreshIndicator } from "@/components/portal/dashboard-refresh-indicator";
import { DashboardOfflineEmpty, useIsOfflineWithoutCache } from "@/components/portal/dashboard-offline-empty";

export const Route = createFileRoute("/_authenticated/m/")({
  component: MemberHome,
  validateSearch: (s: Record<string, unknown>): { upgrade?: string } => ({ upgrade: (s.upgrade as string) ?? undefined }),
});

function MemberHome() {
  const fetchMe = useServerFn(getCurrentMember);
  const search = useSearch({ from: "/_authenticated/m/" });
  const qc = useQueryClient();
  const offlineNoCache = useIsOfflineWithoutCache();
  useEffect(() => {
    if (search.upgrade === "success") {
      toast.success("Payment received — your new access will appear in a few seconds.");
      const t = setTimeout(() => qc.invalidateQueries({ queryKey: ["m-me"] }), 2000);
      return () => clearTimeout(t);
    }
  }, [search.upgrade, qc]);
  const { data: me } = useQuery({ queryKey: ["m-me"], queryFn: () => fetchMe() });

  if (offlineNoCache) return <DashboardOfflineEmpty />;

  return (
    <div className="space-y-6 pb-safe-bottom">
      <PageHeader
        title={`Welcome${me?.member?.full_name ? `, ${me.member.full_name.split(" ")[0]}` : ""}`}
        subtitle="Your training at a glance."
      />
      <div className="-mt-3 flex justify-end">
        <DashboardRefreshIndicator />
      </div>
      {me?.member?.user_id && (
        <HomeBodyweightCard
          userId={me.member.user_id}
          surface="member"
          defaultUnit={(me.member.units_preference as "kg" | "lb") ?? "lb"}
        />
      )}
      {me?.member?.user_id && (
        <HomeWaterCard
          userId={me.member.user_id}
          currentUserId={me.member.user_id}
          surface="member"
        />
      )}
      {me?.member?.user_id && (
        <ProgressSummaryCard
          userId={me.member.user_id}
          currentUserId={me.member.user_id}
          viewerRole="owner"
          progressHref={{ kind: "member" }}
        />
      )}
      <SetupChecklist />
      <Card className="p-5">
        <Link to="/m/more" className="flex items-center gap-3 -m-1 rounded-lg p-1 transition hover:bg-muted/40">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Settings className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Manage Membership</div>
            <div className="text-xs text-muted-foreground">
              Billing, receipts, profile, notifications, and account settings.
            </div>
          </div>
          <Button variant="ghost" size="icon" tabIndex={-1} aria-hidden>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </Link>
      </Card>
    </div>
  );
}
