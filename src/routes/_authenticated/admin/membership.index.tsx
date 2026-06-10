import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Users, Sparkles, AlertCircle, CreditCard, Camera, Phone, MessageCircle,
  Pause, ListChecks, XCircle, TrendingUp, Clock,
} from "lucide-react";
import { getMembershipStats } from "@/lib/membership-admin.functions";

export const Route = createFileRoute("/_authenticated/admin/membership/")({
  component: MembershipDashboard,
});

function Stat({ label, value, icon: Icon, tone = "default", to }: { label: string; value: number | string; icon: any; tone?: "default" | "warn" | "primary" | "rose"; to?: string }) {
  const inner = (
    <Card className="border-border bg-card p-4 transition-colors hover:bg-muted/40">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-black tracking-tight md:text-3xl">{value}</div>
        </div>
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${
          tone === "primary" ? "bg-emerald-500/15 text-emerald-300" :
          tone === "warn" ? "bg-amber-500/15 text-amber-300" :
          tone === "rose" ? "bg-rose-500/15 text-rose-300" :
          "bg-secondary text-foreground"
        }`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </Card>
  );
  return to ? <Link to={to as any}>{inner}</Link> : inner;
}

function MembershipDashboard() {
  const fetch = useServerFn(getMembershipStats);
  const { data, isLoading } = useQuery({ queryKey: ["jf-membership-stats"], queryFn: () => fetch(), refetchInterval: 60_000 });
  const c = data?.counts;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Membership Admin Dashboard"
        subtitle="JF Membership signups, subscriptions, setup health & content."
        actions={
          <Link to="/admin/membership/action-needed"><Button variant="outline"><AlertCircle className="mr-2 h-4 w-4" />Action Needed</Button></Link>
        }
      />

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
          <Sparkles className="mr-1 h-3 w-3" />JF Membership Mode
        </Badge>
        <span>Switch back to Coaching above to manage coaching clients.</span>
      </div>

      <div>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Subscriptions</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          <Stat label="Active" value={isLoading ? "…" : c?.active ?? 0} icon={Users} tone="primary" />
          <Stat label="Trialing" value={isLoading ? "…" : c?.trialing ?? 0} icon={Clock} tone="warn" />
          <Stat label="Past Due" value={isLoading ? "…" : c?.past_due ?? 0} icon={CreditCard} tone="rose" />
          <Stat label="Paused" value={isLoading ? "…" : c?.paused ?? 0} icon={Pause} />
          <Stat label="Hold Plan" value={isLoading ? "…" : c?.hold ?? 0} icon={ListChecks} />
          <Stat label="Cancelled" value={isLoading ? "…" : c?.cancelled ?? 0} icon={XCircle} />
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Setup health</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Incomplete Setup" value={isLoading ? "…" : c?.incomplete_setup ?? 0} icon={ListChecks} tone="warn" to="/admin/membership/action-needed" />
          <Stat label="Missing Profile Pic" value={isLoading ? "…" : c?.missing_pfp ?? 0} icon={Camera} tone="warn" to="/admin/membership/action-needed" />
          <Stat label="Missing Phone" value={isLoading ? "…" : c?.missing_phone ?? 0} icon={Phone} to="/admin/membership/action-needed" />
          <Stat label="SMS Consent Missing" value={isLoading ? "…" : c?.missing_sms ?? 0} icon={MessageCircle} to="/admin/membership/action-needed" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold">Recent signups</h3>
            <Link to="/admin/membership/signup-stats" className="text-xs text-primary hover:underline"><TrendingUp className="mr-1 inline h-3 w-3" />View signup stats</Link>
          </div>
          {data?.recentSignups?.length ? (
            <ul className="divide-y divide-border text-sm">
              {data.recentSignups.map((m: any) => (
                <li key={m.id} className="flex items-center justify-between py-2">
                  <Link to="/admin/members/$memberId" params={{ memberId: m.id }} className="truncate hover:underline">
                    {m.full_name || m.email}
                  </Link>
                  <span className="text-xs text-muted-foreground">{new Date(m.created_at).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          ) : <div className="text-xs text-muted-foreground">No signups yet.</div>}
        </Card>

        <Card className="p-4">
          <h3 className="mb-2 text-sm font-bold">Upcoming trial endings</h3>
          {data?.upcomingTrialEndings?.length ? (
            <ul className="divide-y divide-border text-sm">
              {data.upcomingTrialEndings.map((m: any) => (
                <li key={m.id} className="flex items-center justify-between py-2">
                  <Link to="/admin/members/$memberId" params={{ memberId: m.id }} className="truncate hover:underline">
                    {m.full_name || m.email}
                  </Link>
                  <span className="text-xs text-amber-300">Trial ends {new Date(m.trial_end_at).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          ) : <div className="text-xs text-muted-foreground">No trials ending in the next 7 days.</div>}
        </Card>
      </div>
    </div>
  );
}