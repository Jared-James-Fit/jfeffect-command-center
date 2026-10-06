import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClientNameLink } from "@/components/clients/client-name-link";
import { adminClientAgreementDetail } from "@/lib/coaching-agreement.functions";
import { rosterStatusOf } from "@/lib/coaching-agreement/rules";
import { ADMIN_AGREEMENT_QUERY_ROOT, AgreementStatusChip } from "./admin-agreement-parts";

/**
 * Where a purchase sits, the question is "has this client signed the Coaching Agreement?"
 * (one signature covers every purchase). Shares its query with the client's agreement
 * panel, and renders nothing while loading, on error, or when the tables aren't there.
 */
export function ClientAgreementBadge({ clientId }: { clientId: string | null | undefined }) {
  const detailFn = useServerFn(adminClientAgreementDetail);
  const { data } = useQuery({
    queryKey: [ADMIN_AGREEMENT_QUERY_ROOT, "detail", clientId],
    enabled: !!clientId,
    queryFn: () => detailFn({ data: { clientId: clientId! } }),
    staleTime: 60_000,
    retry: false,
  });
  if (!clientId || !data) return null;
  return (
    <ClientNameLink
      clientId={clientId}
      tab="agreements"
      ariaLabel="Open this client's Coaching Agreement"
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
      onClick={(e) => e.stopPropagation()}
    >
      Coaching Agreement:
      <AgreementStatusChip status={rosterStatusOf(data.state, data.hasAccount)} />
    </ClientNameLink>
  );
}
