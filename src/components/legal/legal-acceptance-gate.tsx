import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMyLegalStatus } from "@/lib/legal.functions";
import { ClientLegalSafety } from "./client-legal-safety";
import { useAuth } from "@/lib/auth";
import { SIGNUP_LEGAL_SLUGS } from "@/lib/legal-signup";
import { MEMBERSHIP_AGREEMENT_SLUG } from "@/lib/membership-agreement/acks";
import { AgreementAccessScreen } from "./agreement-access-screen";
import type { ReactNode } from "react";

/** Required account terms and explicitly enforced documents are a prerequisite,
 * not a dialog over a live portal. The member-specific signature uses its own flow.
 * Optional consent, emergency-disabled and workflow-only documents are not forced. */
export function LegalAcceptanceGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const fn = useServerFn(listMyLegalStatus);
  const q = useQuery({
    queryKey: ["legal-status", user?.id ?? "anon"],
    enabled: !!user?.id,
    queryFn: () => fn(),
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  if (q.isError || !q.data) return <AgreementAccessScreen checking={!q.isError} retry={() => void q.refetch()} />;
  const blocking = q.data.filter((d) =>
    !d.accepted_at && !d.satisfied_by_prior_version && !d.emergency_disabled && !d.is_optional_consent &&
    d.slug !== MEMBERSHIP_AGREEMENT_SLUG &&
    ((SIGNUP_LEGAL_SLUGS as readonly string[]).includes(d.slug) ||
      (d.is_required && d.effective_enforcement === "full_portal_gate")),
  );
  if (blocking.length) return (
    <AgreementAccessScreen title="Review your terms" description="Accept the required documents below to continue setting up your account.">
      <ClientLegalSafety bare requiredOnly={blocking.map(d => d.document_id)} />
    </AgreementAccessScreen>
  );
  return <>{children}</>;
}
