import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import {
  defaultAnalyticsFilter,
  exactBlockFilter,
  type AnalyticsFilter,
} from "@/components/analytics/analytics-filter-bar";
import { type AnalyticsBlock, normalizeAnalyticsBlock } from "@/lib/analytics/blocks";
import { ClientAnalyticsDashboard, ANALYTICS_VIEWS, type AnalyticsView } from "@/components/analytics/client-analytics-dashboard";
import { isPrimaryProgramBlock } from "@/lib/at-home-backup";
import { clientTrainingHref } from "@/lib/editor-back";

/**
 * The coach's Training Analytics for a client: the same dashboard the client
 * sees (one set of numbers, one look), with the coach's extras on (coaching
 * insights, intensity spread, programming detail). It used to be a separate,
 * older page with its own charts that disagreed with the client's.
 */
const analyticsSearchSchema = z.object({
  filter: fallback(z.string(), "").default(""),
  blockId: fallback(z.string(), "").default(""),
  view: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/_authenticated/admin/client-programs/$clientId/analytics")({
  validateSearch: zodValidator(analyticsSearchSchema),
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const { clientId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: client } = useQuery({
    queryKey: ["client-analytics-head", clientId],
    staleTime: 60_000,
    queryFn: async () =>
      (await supabase.from("clients").select("id, full_name, preferred_weight_unit").eq("id", clientId).maybeSingle()).data,
  });
  const { data: clientBlocks = [] } = useQuery<AnalyticsBlock[]>({
    queryKey: ["pl-blocks-for-analytics", clientId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("pl_blocks")
        .select(
          "id, name, status, start_date, end_date, weeks, sort_order, training_focus, prep_id, source_template_block_key, pl_preps(id, title, event_name, event_date)",
        )
        .eq("client_id", clientId)
        .order("sort_order", { ascending: true });
      return (data ?? []).filter(isPrimaryProgramBlock).map(normalizeAnalyticsBlock);
    },
  });
  const initialFilter: AnalyticsFilter | null = useMemo(() => {
    if (!clientBlocks.length) return null;
    if (search.filter === "exact_block" && search.blockId) {
      const block = clientBlocks.find((b) => b.id === search.blockId);
      if (block) return exactBlockFilter(block, clientBlocks);
    }
    return defaultAnalyticsFilter(clientBlocks);
  }, [clientBlocks, search.filter, search.blockId]);
  const initialView = ANALYTICS_VIEWS.some(([v]) => v === search.view) ? (search.view as AnalyticsView) : undefined;

  return (
    <>
      <PageHeader
        title="Training Analytics"
        subtitle={client?.full_name ?? ""}
        backTo={clientTrainingHref(clientId)}
        backLabel="Training"
      />
      <div className="p-4 pb-10 md:p-8">
        <ClientAnalyticsDashboard
          clientId={clientId}
          preferredUnit={client?.preferred_weight_unit === "kg" ? "kg" : "lb"}
          initialFilter={initialFilter}
          coach
          canOpenLog
          initialView={initialView}
          onViewChange={(v) => navigate({ search: (prev: any) => ({ ...prev, view: v === "overview" ? "" : v }), replace: true })}
          onFilterChange={(next) =>
            navigate({
              search: (prev: any) => ({
                ...prev,
                filter: next.preset === "exact_block" ? "exact_block" : "",
                blockId: next.preset === "exact_block" ? (next as any).blockId : "",
              }),
              replace: true,
            })
          }
          viewAllPRsNode={
            <Link
              to="/admin/client-programs/$clientId/history"
              params={{ clientId }}
              className="inline-flex min-h-10 items-center text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              History
            </Link>
          }
        />
      </div>
    </>
  );
}
