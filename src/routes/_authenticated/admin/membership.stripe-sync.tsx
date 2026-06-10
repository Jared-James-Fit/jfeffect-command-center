import { createFileRoute } from "@tanstack/react-router";
import { MembershipLeaf, ComingSoonCard } from "@/components/admin/membership-leaf";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/membership/stripe-sync")({
  component: StripeSyncPage,
});

function StripeSyncPage() {
  return (
    <MembershipLeaf title="Stripe Sync" subtitle="Resync subscription status from Stripe.">
      <Card className="p-4 space-y-3 text-sm">
        <p>Per-member sync is available on the member profile page under the <strong>Billing</strong> tab. Bulk resync runs automatically via the Stripe webhook on every billing event.</p>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/members"><Button variant="outline">Open Members list</Button></Link>
          <Button variant="outline" onClick={() => toast.message("Bulk Stripe resync coming soon.")}><RefreshCw className="mr-1 h-3 w-3" />Force resync all (soon)</Button>
        </div>
      </Card>
      <ComingSoonCard note="Bulk resync of all JF members against Stripe will live here." />
    </MembershipLeaf>
  );
}