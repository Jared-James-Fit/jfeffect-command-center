import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { ClientNameLink } from "@/components/clients/client-name-link";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { ShieldCheck, AlertTriangle, FileText, CircleSlash } from "lucide-react";
import { ClientAgreementBadge } from "@/components/coaching-agreement/client-agreement-badge";

export type PurchaseAgreementStatus =
  | "Not Required"
  | "Missing"
  | "Blocking Start"
  | "Manual Action Needed"
  | "Sent"
  | "Signed"
  | "Verified";

const BADGE: Record<PurchaseAgreementStatus, string> = {
  "Not Required": "bg-muted text-muted-foreground border-border",
  Missing: "bg-warning/15 text-warning border-warning/40",
  "Blocking Start": "bg-destructive/15 text-destructive border-destructive/40",
  "Manual Action Needed": "bg-warning/15 text-warning border-warning/40",
  Sent: "bg-info/15 text-info border-info/40",
  Signed: "bg-success/15 text-success border-success/40",
  Verified: "bg-success/15 text-success border-success/40",
};

export function computePurchaseAgreementStatus(opts: {
  requiresAgreement: boolean;
  agreementBeforeService: boolean;
  termStartDate: string | null | undefined;
  agreements: Array<{ status: string; verification_status: string }>;
}): PurchaseAgreementStatus {
  const { requiresAgreement, agreementBeforeService, termStartDate, agreements } = opts;
  if (!requiresAgreement) return "Not Required";
  if (agreements.length === 0) {
    const startPassed = !!termStartDate && new Date(termStartDate) <= new Date();
    if (agreementBeforeService && startPassed) return "Blocking Start";
    return "Missing";
  }
  // Pick the best status across linked agreements
  const has = (s: string) => agreements.some((a) => a.status === s);
  const hasVerified = agreements.some((a) => a.status === "Verified" || a.verification_status === "Manually Verified" || a.verification_status === "Auto-Matched");
  if (hasVerified) return "Verified";
  if (has("Signed") || has("Completed")) return "Signed";
  if (has("Error") || has("Manual Action Needed") || has("Needs Manual Verification") || has("Needs Resend")) return "Manual Action Needed";
  if (has("Sent") || has("Opened") || has("Waiting on Client")) return "Sent";
  return "Missing";
}

export function PurchaseAgreementBadge({ status }: { status: PurchaseAgreementStatus }) {
  const Icon = status === "Verified" || status === "Signed" ? ShieldCheck
    : status === "Not Required" ? CircleSlash
    : status === "Blocking Start" || status === "Manual Action Needed" || status === "Missing" ? AlertTriangle
    : FileText;
  return (
    <Badge variant="outline" className={`gap-1 ${BADGE[status]}`}>
      <Icon className="h-3 w-3" />
      {status}
    </Badge>
  );
}

/**
 * Live agreement badge for a single purchase row. Purchases are covered by the client's
 * Coaching Agreement (signed in the app), so that is what shows by default. An older
 * per-purchase agreement, when one is linked, still shows its own status.
 */
export function PurchaseAgreementInlineBadge({
  purchaseId,
  clientId,
  requiresAgreement,
  agreementBeforeService,
  termStartDate,
}: {
  purchaseId: string;
  clientId: string;
  requiresAgreement: boolean;
  agreementBeforeService: boolean;
  termStartDate: string | null | undefined;
}) {
  const { data: agreements = [] } = useQuery({
    queryKey: ["purchase-agreements", purchaseId],
    enabled: requiresAgreement,
    queryFn: async () => {
      const { data } = await supabase
        .from("agreements")
        .select("id, status, verification_status")
        .eq("purchase_record_id", purchaseId);
      return data ?? [];
    },
  });
  if (!requiresAgreement || agreements.length === 0) {
    return <ClientAgreementBadge clientId={clientId} />;
  }
  const status = computePurchaseAgreementStatus({
    requiresAgreement, agreementBeforeService, termStartDate, agreements: agreements as any,
  });
  const node = <PurchaseAgreementBadge status={status} />;
  if (status === "Missing" || status === "Blocking Start" || status === "Manual Action Needed") {
    return (
      <ClientNameLink clientId={clientId} tab="agreements" onClick={(e) => e.stopPropagation()}>
        {node}
      </ClientNameLink>
    );
  }
  return node;
}