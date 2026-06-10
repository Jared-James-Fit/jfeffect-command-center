import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SubscriptionRestrictedBanner({ status }: { status: string | null }) {
  if (!status) return null;
  const reason =
    status === "Past Due" ? "Your subscription payment failed."
    : status === "Cancelled" ? "Your subscription was cancelled."
    : status === "Expired" ? "Your subscription has expired."
    : status === "Deactivated" ? "Your account is paused."
    : null;
  if (!reason) return null;
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200 flex flex-wrap items-center gap-3">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <div className="flex-1 min-w-[200px]">
        <div className="font-semibold">{reason}</div>
        <div className="text-xs opacity-80">Your account data and history are saved. Reactivate billing to restore membership access.</div>
      </div>
      <Link to={"/portal/billing" as any}>
        <Button size="sm" variant="outline" className="border-amber-500/50">Manage billing</Button>
      </Link>
    </div>
  );
}