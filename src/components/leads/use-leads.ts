import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { listLeadsFn, type LeadsList } from "@/lib/coaching-leads.functions";
import { leadNeeds } from "@/lib/coaching-leads";

export const LEADS_QUERY_KEY = ["coaching-leads"] as const;

/**
 * One read for the Leads screen, Home's card and the Messages row (admin
 * only). While a reply is being written it checks back every few seconds.
 */
export function useLeads() {
  const { role } = useAuth();
  const list = useServerFn(listLeadsFn);
  const query = useQuery<LeadsList>({
    queryKey: LEADS_QUERY_KEY,
    queryFn: () => list(),
    enabled: role === "admin",
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchInterval: (q) =>
      (q.state.data?.leads ?? []).some((l) => l.reply && (l.reply.status === "pending" || l.reply.status === "generating"))
        ? 4_000
        : 60_000,
  });
  const leads = query.data?.leads ?? [];
  const now = Date.now();
  const waiting = leads.filter((l) => leadNeeds(l.app, now));
  return { ...query, leads, waiting, drafts: query.data?.drafts ?? [], bookingUrl: query.data?.bookingUrl ?? null, enabled: role === "admin" };
}
