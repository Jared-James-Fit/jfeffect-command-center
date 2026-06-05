import type { Database } from "@/integrations/supabase/types";

export type AgreementTemplate = Database["public"]["Tables"]["agreement_templates"]["Row"];
export type Agreement = Database["public"]["Tables"]["agreements"]["Row"];
export type AgreementAuditEntry = Database["public"]["Tables"]["agreement_audit_log"]["Row"];
export type SignNowSettings = Database["public"]["Tables"]["signnow_settings"]["Row"];

export const AGREEMENT_TYPES = [
  "Coaching Agreement + Liability Waiver",
  "In-Person PT Agreement",
  "Online Coaching Agreement",
  "Hybrid Coaching Agreement",
  "Minor / Parent Guardian Agreement",
  "Payor Agreement",
  "Custom Agreement",
] as const;
export type AgreementType = (typeof AGREEMENT_TYPES)[number];

export const AGREEMENT_STATUSES = [
  "Not Sent",
  "Sent",
  "Opened",
  "Waiting on Client",
  "Signed",
  "Completed",
  "Declined",
  "Expired",
  "Cancelled",
  "Needs Resend",
  "Needs Manual Verification",
  "Verified",
  "Error",
  "Manual Action Needed",
] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

export const VERIFICATION_STATUSES = [
  "Not Verified",
  "Auto-Matched",
  "Manually Verified",
  "Signer Name Mismatch",
  "Needs Review",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const SIGNING_METHODS = [
  "Remote Invite",
  "In-Person / iPad",
  "Kiosk Mode",
  "Manual Upload",
  "Manual Link",
] as const;
export type SigningMethod = (typeof SIGNING_METHODS)[number];

export const SIGNNOW_INTEGRATION_STATUSES = [
  "Not Connected",
  "Connected",
  "Needs Setup",
  "Error",
  "Manual Mode",
] as const;

export const STATUS_BADGE: Record<string, string> = {
  "Not Sent": "bg-muted text-muted-foreground",
  Sent: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  Opened: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  "Waiting on Client": "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  Signed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  Completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  Verified: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-300",
  Declined: "bg-red-500/15 text-red-700 dark:text-red-300",
  Expired: "bg-red-500/15 text-red-700 dark:text-red-300",
  Cancelled: "bg-red-500/15 text-red-700 dark:text-red-300",
  Error: "bg-red-500/15 text-red-700 dark:text-red-300",
  "Needs Resend": "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "Needs Manual Verification": "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "Manual Action Needed": "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

export const VERIFICATION_BADGE: Record<string, string> = {
  "Not Verified": "bg-muted text-muted-foreground",
  "Auto-Matched": "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  "Manually Verified": "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "Signer Name Mismatch": "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "Needs Review": "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

export function normalizeName(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function detectMismatch(signerInSignNow: string | null | undefined, clientName: string | null | undefined): boolean {
  const a = normalizeName(signerInSignNow);
  const b = normalizeName(clientName);
  if (!a || !b) return false;
  return a !== b;
}

export function fileLabel(opts: {
  clientName: string;
  agreementType: string;
  signedAt?: string | Date | null;
  offerName?: string | null;
}): string {
  const d = opts.signedAt ? new Date(opts.signedAt) : null;
  const datePart = d ? d.toISOString().slice(0, 10) : "Unsigned";
  const timePart = d ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  const parts = [opts.clientName, opts.offerName, opts.agreementType, datePart, timePart].filter(Boolean);
  return parts.join(" \u2014 ");
}

export function agreementNeedsAttention(a: Agreement): boolean {
  if (a.signer_mismatch) return true;
  if (
    [
      "Sent",
      "Opened",
      "Waiting on Client",
      "Expired",
      "Needs Resend",
      "Needs Manual Verification",
      "Error",
    ].includes(a.status as string)
  ) {
    return true;
  }
  if (a.status === "Signed" && a.verification_status === "Not Verified") return true;
  return false;
}