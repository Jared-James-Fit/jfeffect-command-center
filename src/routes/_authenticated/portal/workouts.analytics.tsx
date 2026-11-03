import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import {
  exactBlockFilter,
  defaultAnalyticsFilter,
  type AnalyticsFilter,
} from "@/components/analytics/analytics-filter-bar";
import {
  type AnalyticsBlock,
  normalizeAnalyticsBlock,
} from "@/lib/analytics/blocks";
import { ClientAnalyticsDashboard } from "@/components/analytics/client-analytics-dashboard";
import { isPrimaryProgramBlock } from "@/lib/at-home-backup";

/**
 * Client-facing analytics dashboard.
 *
 * Reuses the same helpers that drive the coach analytics page so client and
 * coach numbers are guaranteed identical. All calculations use the
 * normalized columns (via getClientResults) — partial sets are excluded
 * because the query requires actual_load AND actual_reps.
 */
const analyticsSearchSchema = z.object({
  filter: fallback(z.string(), "").default(""),
  blockId: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/_authenticated/portal/workouts/analytics")({
  validateSearch: zodValidator(analyticsSearchSchema),
  component: PortalAnalytics,
});

function PortalAnalytics() {
  const portalUserId = usePortalUserId();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: client } = useQuery({
    queryKey: ["my-client-analytics", portalUserId],
    enabled: !!portalUserId,
    staleTime: 60_000,
    queryFn: async () =>
      (await supabase.from("clients").select("id, full_name, preferred_weight_unit")
        .eq("user_id", portalUserId!).maybeSingle()).data,
  });

  const { data: clientBlocks = [] } = useQuery<AnalyticsBlock[]>({
    queryKey: ["pl-blocks-for-analytics", client?.id],
    enabled: !!client?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("pl_blocks")
        .select(
          "id, name, status, start_date, end_date, weeks, sort_order, training_focus, prep_id, source_template_block_key, pl_preps(id, title, event_name, event_date)",
        )
        .eq("client_id", client!.id)
        .order("sort_order", { ascending: true });
      return (data ?? []).filter(isPrimaryProgramBlock).map(normalizeAnalyticsBlock);
    },
  });

  // Resolve URL-requested initial filter so deep-links keep working.
  const initialFilter: AnalyticsFilter | null = useMemo(() => {
    if (!clientBlocks.length) return null;
    if (search.filter === "exact_block" && search.blockId) {
      const block = clientBlocks.find((b) => b.id === search.blockId);
      if (block) return exactBlockFilter(block, clientBlocks);
    }
    return defaultAnalyticsFilter(clientBlocks);
  }, [clientBlocks, search.filter, search.blockId]);

  const handleFilterChange = (next: AnalyticsFilter) => {
    navigate({
      search: (prev: any) => ({
        ...prev,
        filter: next.preset === "exact_block" ? "exact_block" : "",
        blockId: next.preset === "exact_block" ? (next as any).blockId : "",
      }),
      replace: true,
    });
  };

  const preferredUnit = client?.preferred_weight_unit === "kg" ? "kg" : "lb";

  return (
    <>
      {/* the same header (and back) as every other client page that opens from a tab */}
      <PageHeader
        title="Training Analytics"
        subtitle="Your lifts, volume and PRs over time."
        backTo="/portal/workouts"
        backLabel="Workouts"
      />
      <div className="p-4 pb-10 md:p-8">
        {client?.id ? (
          <ClientAnalyticsDashboard
            clientId={client.id}
            preferredUnit={preferredUnit}
            initialFilter={initialFilter}
            onFilterChange={handleFilterChange}
            viewAllPRsNode={
              <Link
                to="/portal/workouts/prs"
                className="inline-flex min-h-10 items-center text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                View all
              </Link>
            }
          />
        ) : null}
      </div>
    </>
  );
}
