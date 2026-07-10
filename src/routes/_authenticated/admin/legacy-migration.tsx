import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ClientNameLink } from "@/components/clients/client-name-link";
import { useServerFn } from "@tanstack/react-start";
import { listClientsWithBillingFn, getBillingDashboardFn } from "@/lib/billing-sources.functions";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/legacy-migration")({
  component: LegacyMigrationPage,
  head: () => ({
    meta: [
      { title: "Legacy Migration Board · Admin · JF Effect" },
      { name: "description", content: "Track existing Trainerize coaching clients as they move into the JF Effect app without changing their billing." },
    ],
  }),
});

type Stage = "not_started" | "invited" | "access_active";

function stageOf(c: any): Stage {
  const ents = (c.entitlements ?? []) as any[];
  const active = ents.some((e) => e.access_source === "legacy_coaching" && e.status === "active");
  if (active) return "access_active";
  if (ents.length > 0) return "invited";
  return "not_started";
}

const STAGE_META: Record<Stage, { label: string; tone: string; help: string }> = {
  not_started: {
    label: "Not started",
    tone: "bg-muted text-muted-foreground",
    help: "Marked as Trainerize Legacy but no app entitlement issued yet.",
  },
  invited: {
    label: "Invited",
    tone: "bg-sky-500/10 text-sky-700 border-sky-500/30",
    help: "Entitlement created. Waiting for the client to sign in to the app.",
  },
  access_active: {
    label: "Access active",
    tone: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
    help: "Using the JF Effect app. Billing remains in legacy Trainerize Stripe.",
  },
};

function LegacyMigrationPage() {
  const listFn = useServerFn(listClientsWithBillingFn);
  const dashFn = useServerFn(getBillingDashboardFn);

  const { data, isLoading } = useQuery({
    queryKey: ["legacy-migration-board"],
    queryFn: () => listFn({ data: { billingSource: "trainerize_legacy" } }),
  });
  const { data: dash } = useQuery({
    queryKey: ["billing-dashboard"],
    queryFn: () => dashFn(),
  });

  const clients = data?.clients ?? [];
  const buckets: Record<Stage, any[]> = { not_started: [], invited: [], access_active: [] };
  for (const c of clients) buckets[stageOf(c)].push(c);

  return (
    <>
      <PageHeader
        title="Legacy Migration"
        subtitle="Move existing Trainerize coaching clients into the JF Effect app without touching their billing."
      />
      <div className="space-y-6 p-3 sm:p-4 md:p-6">
        <Card className="border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <div className="font-semibold mb-1">Billing safety</div>
          <p className="text-muted-foreground">
            Every client below is locked to the legacy <span className="font-semibold">JF Effect Trainerize</span> Stripe account. Inviting them into the app grants app access only — no Stripe customer, subscription, or charge is created in the new JF Effect Stripe account.
          </p>
        </Card>

        <div className="grid gap-3 sm:grid-cols-3">
          {(["not_started", "invited", "access_active"] as Stage[]).map((s) => (
            <Card key={s} className="border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${STAGE_META[s].tone}`}>
                  {STAGE_META[s].label}
                </span>
                <span className="text-2xl font-semibold tabular-nums">{buckets[s].length}</span>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">{STAGE_META[s].help}</p>
            </Card>
          ))}
        </div>

        {dash && (
          <Card className="border-border bg-card p-4 text-xs text-muted-foreground">
            Legacy records on file: <span className="font-semibold text-foreground">{dash.legacy.records_total}</span>
            {" · "}Active legacy billing: <span className="font-semibold text-foreground">{dash.legacy.active_count}</span>
            {" · "}Estimated legacy revenue: <span className="font-semibold text-foreground">${(dash.legacy.total_cents_estimated / 100).toFixed(2)}</span>
            <span className="ml-2">(not Stripe-verified)</span>
          </Card>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          {(["not_started", "invited", "access_active"] as Stage[]).map((s) => (
            <div key={s} className="space-y-2">
              <div className="text-xs uppercase tracking-widest text-muted-foreground px-1">
                {STAGE_META[s].label} ({buckets[s].length})
              </div>
              {isLoading ? (
                <Card className="p-4 text-xs text-muted-foreground">Loading…</Card>
              ) : buckets[s].length === 0 ? (
                <Card className="p-4 text-xs text-muted-foreground flex items-center gap-2">
                  <Users className="h-4 w-4" /> None
                </Card>
              ) : (
                buckets[s].map((c) => (
                  <Card key={c.id} className="p-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{c.full_name ?? "Unnamed"}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{c.email ?? "—"}</div>
                      </div>
                      <ClientNameLink clientId={c.id}>
                        <Button variant="ghost" size="sm" className="h-7 px-2">
                          Open <ArrowRight className="ml-1 h-3 w-3" />
                        </Button>
                      </ClientNameLink>
                    </div>
                    {c.legacy_billing && (
                      <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-muted-foreground">
                        {c.legacy_billing.plan_name && <Badge variant="outline" className="text-[10px]">{c.legacy_billing.plan_name}</Badge>}
                        {c.legacy_billing.status && <Badge variant="outline" className="text-[10px]">{c.legacy_billing.status}</Badge>}
                        {c.legacy_billing.amount_cents != null && (
                          <span className="tabular-nums">
                            ${(c.legacy_billing.amount_cents / 100).toFixed(2)}{c.legacy_billing.billing_interval ? `/${c.legacy_billing.billing_interval}` : ""}
                          </span>
                        )}
                      </div>
                    )}
                  </Card>
                ))
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <Link to="/admin/billing-sources">
            <Button variant="outline" size="sm">Add or classify a legacy client →</Button>
          </Link>
        </div>
      </div>
    </>
  );
}