import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Inline status banner for JF members whose subscription is not in a "full
 * access" state. Accepts either the legacy `member.status` (Active /
 * Cancelled / Past Due / …) or the richer `member.subscription_status`
 * (Trialing / Active / Hold Plan / Paused / Payment Failed / Past Due /
 * Cancelled / Expired). Passing both is preferred.
 */
export function SubscriptionRestrictedBanner({
  status,
  subscriptionStatus,
}: {
  status?: string | null;
  subscriptionStatus?: string | null;
}) {
  const s = subscriptionStatus || status || null;
  if (!s) return null;
  const reason =
    s === "Past Due" ? "Your subscription payment is past due."
    : s === "Payment Failed" ? "Your last payment didn't go through."
    : s === "Hold Plan" ? "You're on the $9 Hold Plan."
    : s === "Paused" ? "Your membership is frozen."
    : s === "Cancelled" ? "Your subscription was cancelled."
    : s === "Expired" ? "Your subscription has expired."
    : s === "Deactivated" ? "Your account is paused."
    : null;
  if (!reason) return null;
  const detail =
    s === "Hold Plan"
      ? "Full membership features are locked while on the Hold Plan. Reactivate full membership to restore access."
      : s === "Paused"
      ? "Your billing is paused. Access resumes when the freeze ends — or reactivate now."
      : "Your account data and history are saved. Reactivate billing to restore membership access.";
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200 flex flex-wrap items-center gap-3">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <div className="flex-1 min-w-[200px]">
        <div className="font-semibold">{reason}</div>
        <div className="text-xs opacity-80">{detail}</div>
      </div>
      <Link to={"/m/billing" as any}>
        <Button size="sm" variant="outline" className="border-amber-500/50">Manage billing</Button>
      </Link>
    </div>
  );
}