import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MembershipLeaf } from "@/components/admin/membership-leaf";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listMembers } from "@/lib/members.functions";
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/admin/membership/billing")({
  component: BillingPage,
});

function BillingPage() {
  const fetch = useServerFn(listMembers);
  const { data } = useQuery({ queryKey: ["jf-billing-members"], queryFn: () => fetch({ data: { accountType: "jf_member" } }) });
  const all = data?.members ?? [];
  const [tab, setTab] = useState("active");

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
              <Link key={m.id} to="/admin/members/$memberId" params={{ memberId: m.id }} className="flex items-center justify-between p-3 hover:bg-muted/40">
                <div className="min-w-0">
                  <div className="truncate font-medium">{m.full_name || m.email}</div>
                  <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                </div>
                <Badge variant="outline">{m.subscription_status ?? "—"}</Badge>
              </Link>
            ))}
          </Card>
        </TabsContent>
      </Tabs>
    </MembershipLeaf>
  );
}