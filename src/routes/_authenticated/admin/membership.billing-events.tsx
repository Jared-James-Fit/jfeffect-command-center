import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { adminListBillingEvents } from "@/lib/launch-readiness.functions";

export const Route = createFileRoute("/_authenticated/admin/membership/billing-events")({
  component: BillingEventsPage,
});

function BillingEventsPage() {
  const [type, setType] = useState("");
  const fetch = useServerFn(adminListBillingEvents);
  const { data, isLoading } = useQuery({
    queryKey: ["jf-billing-events", type],
    queryFn: () => fetch({ data: { limit: 200, type: type || undefined } }),
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Billing Events" subtitle="Verified Stripe webhook events. No secrets shown." />
      <Card className="p-3">
        <Input
          placeholder="Filter by event type (e.g. customer.subscription.updated)"
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="max-w-md"
        />
      </Card>
      <Card className="overflow-x-auto p-0">
        {isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        ) : (data?.length ?? 0) === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No events.</div>
        ) : (
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">When</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Mode</th>
                <th className="px-3 py-2 text-left">Member</th>
                <th className="px-3 py-2 text-left">Subscription</th>
                <th className="px-3 py-2 text-left">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data!.map((r: any) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {new Date(r.processed_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.type}</td>
                  <td className="px-3 py-2 text-xs">
                    <Badge variant="outline" className={r.livemode ? "border-rose-500/30 text-rose-300" : "border-amber-500/30 text-amber-300"}>
                      {r.livemode === null ? "—" : r.livemode ? "live" : "test"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.member_id ? (
                      <Link to="/admin/members/$memberId" params={{ memberId: r.member_id }} className="text-primary hover:underline">view</Link>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{r.subscription_id ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{r.summary ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}