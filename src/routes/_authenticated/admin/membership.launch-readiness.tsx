import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, XCircle, EyeOff, RefreshCw, ExternalLink, ArrowRight } from "lucide-react";
import { getLaunchReadiness, type ReadinessCheck } from "@/lib/launch-readiness.functions";

export const Route = createFileRoute("/_authenticated/admin/membership/launch-readiness")({
  component: LaunchReadinessPage,
});

const STATE_META: Record<string, { label: string; icon: any; cls: string }> = {
  ready:   { label: "Ready",   icon: CheckCircle2, cls: "text-emerald-300 bg-emerald-500/15 border-emerald-500/30" },
  warning: { label: "Warning", icon: AlertTriangle, cls: "text-amber-300 bg-amber-500/15 border-amber-500/30" },
  blocked: { label: "Blocked", icon: XCircle,     cls: "text-rose-300 bg-rose-500/15 border-rose-500/30" },
  manual:  { label: "Manual",  icon: EyeOff,      cls: "text-sky-300 bg-sky-500/15 border-sky-500/30" },
};

function LaunchReadinessPage() {
  const fetch = useServerFn(getLaunchReadiness);
  const qc = useQueryClient();
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["jf-launch-readiness"],
    queryFn: () => fetch(),
    staleTime: 0,
    gcTime: 0,
  });

  const recheck = async () => {
    await qc.invalidateQueries({ queryKey: ["jf-launch-readiness"] });
    await refetch();
  };

  const grouped = (data?.checks ?? []).reduce<Record<string, ReadinessCheck[]>>((acc, c) => {
    (acc[c.group] ||= []).push(c);
    return acc;
  }, {});

  // Blocker-first summary: every check that currently prevents checkout or promotion.
  const blockers = (data?.checks ?? []).filter(
    (c) => c.state === "blocked" || c.blocks_checkout || c.blocks_promotion,
  );
  const checkoutBlockers = blockers.filter((b) => b.blocks_checkout);
  const promotionBlockers = blockers.filter((b) => b.blocks_promotion && !b.blocks_checkout);

  const summaryTone = data?.summary === "Ready to Promote and Sell"
    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
    : data?.summary === "Ready for Final Manual Verification"
      ? "bg-sky-500/15 text-sky-300 border-sky-500/30"
      : data?.summary === "Ready for Test-Mode QA"
        ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
        : "bg-rose-500/15 text-rose-300 border-rose-500/30";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Launch Readiness"
        subtitle="Every check the membership needs before promoting. Read-only."
        actions={
          <Button onClick={recheck} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Re-check Launch Readiness
          </Button>
        }
      />

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading checks…</div>
      ) : (
        <>
          <Card className={`p-4 border ${summaryTone}`}>
            <div className="text-xs uppercase tracking-widest opacity-80">Overall</div>
            <div className="text-2xl font-black tracking-tight">{data?.summary}</div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <Badge variant="outline" className="border-emerald-500/30">{data?.counts.ready ?? 0} ready</Badge>
              <Badge variant="outline" className="border-amber-500/30">{data?.counts.warning ?? 0} warning</Badge>
              <Badge variant="outline" className="border-rose-500/30">{data?.counts.blocked ?? 0} blocked</Badge>
              <Badge variant="outline" className="border-sky-500/30">{data?.counts.manual ?? 0} manual</Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Link to="/admin/membership/billing-events"><Button size="sm" variant="outline">Billing Events</Button></Link>
              <Link to="/admin/membership/notifications"><Button size="sm" variant="outline">Notification Attempts</Button></Link>
              <Link to="/admin/settings"><Button size="sm" variant="outline">Membership Settings</Button></Link>
              <Link to="/admin/legal"><Button size="sm" variant="outline">Legal Workspace</Button></Link>
            </div>
          </Card>

          {blockers.length > 0 && (
            <Card className="p-4 border border-rose-500/30 bg-rose-500/5 space-y-3">
              <div>
                <div className="text-xs uppercase tracking-widest text-rose-300">Action required</div>
                <div className="text-lg font-bold">
                  {checkoutBlockers.length} blocker(s) for Checkout · {promotionBlockers.length} additional blocker(s) for Promotion
                </div>
              </div>
              <ul className="space-y-2">
                {blockers.map((b) => (
                  <li key={b.key} className="flex flex-col gap-1 rounded-md border border-rose-500/20 bg-background/40 p-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">{b.label}</span>
                        {b.owner && <Badge variant="outline" className="text-[10px]">Owner: {b.owner}</Badge>}
                        {b.blocks_checkout && <Badge className="bg-rose-500/20 text-rose-200 text-[10px] border border-rose-500/40">Blocks Checkout</Badge>}
                        {b.blocks_promotion && !b.blocks_checkout && <Badge className="bg-amber-500/20 text-amber-200 text-[10px] border border-amber-500/40">Blocks Promotion</Badge>}
                      </div>
                      {b.next_step ? (
                        <div className="mt-1 text-xs text-muted-foreground">{b.next_step}</div>
                      ) : b.detail ? (
                        <div className="mt-1 text-xs text-muted-foreground break-words">{b.detail}</div>
                      ) : null}
                    </div>
                    {b.action_href && b.action_label && (
                      b.action_href.startsWith("http") ? (
                        <a href={b.action_href} target="_blank" rel="noreferrer">
                          <Button size="sm" variant="outline">
                            {b.action_label}<ExternalLink className="ml-1 h-3 w-3" />
                          </Button>
                        </a>
                      ) : (
                        <Link to={b.action_href as any}>
                          <Button size="sm" variant="outline">
                            {b.action_label}<ArrowRight className="ml-1 h-3 w-3" />
                          </Button>
                        </Link>
                      )
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(grouped).map(([group, items]) => (
              <Card key={group} className="p-4">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">{group}</h3>
                <ul className="space-y-2">
                  {items.map((c) => {
                    const meta = STATE_META[c.state] ?? STATE_META.warning;
                    const Icon = meta.icon;
                    return (
                      <li key={c.key} className={`flex items-start gap-2 rounded-md border p-2 ${meta.cls}`}>
                        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-foreground">{c.label}</div>
                          {c.detail ? <div className="text-xs text-muted-foreground break-words">{c.detail}</div> : null}
                          {c.next_step && c.state !== "ready" ? (
                            <div className="mt-1 text-xs text-foreground/80">→ {c.next_step}</div>
                          ) : null}
                          {c.action_href && c.action_label && c.state !== "ready" ? (
                            <div className="mt-1">
                              {c.action_href.startsWith("http") ? (
                                <a href={c.action_href} target="_blank" rel="noreferrer" className="text-xs underline">
                                  {c.action_label} ↗
                                </a>
                              ) : (
                                <Link to={c.action_href as any} className="text-xs underline">{c.action_label} →</Link>
                              )}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <Badge variant="outline" className="text-[10px]">{meta.label}</Badge>
                          {c.owner ? <span className="text-[10px] text-muted-foreground">{c.owner}</span> : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            ))}
          </div>

          <div className="text-xs text-muted-foreground">
            Last checked {data?.generated_at ? new Date(data.generated_at).toLocaleString() : "—"}
          </div>
        </>
      )}
    </div>
  );
}