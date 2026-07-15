import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MembershipLeaf } from "@/components/admin/membership-leaf";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listMembers } from "@/lib/members.functions";
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ManageSubscriptionPanel } from "@/components/billing/manage-subscription";
import { Settings2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/membership/billing")({
  component: BillingPage,
});

function BillingPage() {
  const fetch = useServerFn(listMembers);
  const { data } = useQuery({ queryKey: ["jf-billing-members"], queryFn: () => fetch({ data: { accountType: "jf_member" } }) });
  const all = data?.members ?? [];
  const [tab, setTab] = useState("active");
  const [managing, setManaging] = useState<any | null>(null);

  const filt: Record<string, (m: any) => boolean> = {
    active: (m) => m.subscription_status === "Active",
    trialing: (m) => m.subscription_status === "Trialing",
    past_due: (m) => ["Past Due", "Payment Failed"].includes(m.subscription_status ?? ""),
    paused: (m) => !!m.paused_until || m.subscription_status === "Paused",
    hold: (m) => !!m.hold_plan_started_at || m.subscription_status === "Hold Plan",
    cancelled: (m) => m.subscription_status === "Cancelled" || !!m.cancelled_at,
  };
  const list = all.filter(filt[tab] ?? (() => true));

  return (
    <MembershipLeaf title="Subscriptions & Billing" subtitle="Filter JF members by subscription state.">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="trialing">Trialing</TabsTrigger>
          <TabsTrigger value="past_due">Past Due</TabsTrigger>
          <TabsTrigger value="paused">Paused</TabsTrigger>
          <TabsTrigger value="hold">Hold Plan</TabsTrigger>
          <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
        </TabsList>
        <TabsContent value={tab}>
          <Card className="mt-3 divide-y divide-border">
            {list.length === 0 && <div className="p-6 text-sm text-muted-foreground">No members in this state.</div>}
            {list.map((m: any) => (
              <div key={m.id} className="flex items-center justify-between gap-2 p-3 hover:bg-muted/40">
                <Link
                  to="/admin/members/$memberId"
                  params={{ memberId: m.id }}
                  className="min-w-0 flex-1"
                >
                  <div className="truncate font-medium">{m.full_name || m.email}</div>
                  <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                </Link>
                <Badge variant="outline">{m.subscription_status ?? "—"}</Badge>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setManaging(m)}
                  disabled={!m.stripe_subscription_id}
                  title={m.stripe_subscription_id ? "Manage subscription" : "No Stripe subscription on file"}
                >
                  <Settings2 className="mr-1 h-3.5 w-3.5" /> Manage
                </Button>
              </div>
            ))}
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!managing} onOpenChange={(o) => { if (!o) setManaging(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{managing?.full_name || managing?.email || "Subscription"}</DialogTitle>
          </DialogHeader>
          {managing && (
            <ManageSubscriptionPanel
              member={{ id: managing.id, full_name: managing.full_name, email: managing.email }}
            />
          )}
        </DialogContent>
      </Dialog>
    </MembershipLeaf>
  );
}