import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { AnalyticsPage, type AnalyticsSearch } from "@/components/admin/analytics/analytics-page";
import { BI_TABS, type BiTab } from "@/lib/bi/model";
import { isIsoDay, PERIOD_PRESETS, type PresetKey } from "@/lib/bi/period";

/**
 * Analytics (Nov 25 2026): the website, the applications, the coaching business and the whole app
 * in one place, one tab per question (lib/bi). Admin only; the server checks again. The tab and
 * the period are in the address (?tab=acquisition&p=90d, or p=custom&from=…&to=…).
 */
export const Route = createFileRoute("/_authenticated/admin/insights")({
  head: () => ({ meta: [{ title: "Analytics · JF Effect" }] }),
  validateSearch: (s: Record<string, unknown>): AnalyticsSearch => {
    const out: AnalyticsSearch = {};
    if (typeof s.tab === "string" && (BI_TABS as readonly string[]).includes(s.tab)) out.tab = s.tab as BiTab;
    const presets = [...PERIOD_PRESETS.map((p) => p.key), "custom"] as string[];
    if (typeof s.p === "string" && presets.includes(s.p)) out.p = s.p as PresetKey;
    if (isIsoDay(s.from)) out.from = s.from;
    if (isIsoDay(s.to)) out.to = s.to;
    return out;
  },
  component: InsightsRoute,
});

function InsightsRoute() {
  const { accountRole, loading } = useAuth();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  if (loading) return <Loader2 className="m-4 h-5 w-5 animate-spin" />;
  if (accountRole !== "admin") {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <PageHeader title="Analytics" />
        <Card className="p-4 text-[13px] text-muted-foreground">Only an admin can see this page.</Card>
      </div>
    );
  }
  return (
    <>
      <PageHeader title="Analytics" />
      <AnalyticsPage search={search} onSearch={(next) => void navigate({ search: next as any, replace: true })} />
    </>
  );
}
