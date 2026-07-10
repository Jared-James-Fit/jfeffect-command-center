import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { setPovPersona } from "@/lib/pov.functions";
import { setPovFlag } from "@/components/pov-quick-toggle";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Users, Sparkles, AlertCircle, CreditCard, Camera, Phone, MessageCircle, Mail,
  Pause, ListChecks, XCircle, TrendingUp, Clock,
  Eye, ShieldCheck, AlertTriangle, Gift, UserSearch, Tags, FileText, Activity, Package, UserCog,
} from "lucide-react";
import { getMembershipStats, getRecentlyExpiredMembers, grantTemporaryAccess } from "@/lib/membership-admin.functions";

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
  const navigate = useNavigate();
  const qc = useQueryClient();
  const setPersona = useServerFn(setPovPersona);
  const [povBusy, setPovBusy] = useState(false);

  const fetchExpired = useServerFn(getRecentlyExpiredMembers);
  const expiredQuery = useQuery({ queryKey: ["jf-recently-expired"], queryFn: () => fetchExpired(), refetchInterval: 60_000 });
  const grant = useServerFn(grantTemporaryAccess);
  const [grantingId, setGrantingId] = useState<string | null>(null);
  const onGrant = async (memberId: string, name: string) => {
    if (grantingId) return;
    setGrantingId(memberId);
    try {
      await grant({ data: { memberId, days: 7 } });
      toast.success(`Granted 7-day access to ${name}`);
      await qc.invalidateQueries({ queryKey: ["jf-recently-expired"] });
      await qc.invalidateQueries({ queryKey: ["jf-membership-stats"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not grant access");
    } finally {
      setGrantingId(null);
    }
  };

  const enterPov = async () => {
    if (povBusy) return;
    setPovBusy(true);
    try {
      await setPersona({ data: { persona: "app_member" } as any });
      setPovFlag("app_member");
      await qc.invalidateQueries({ queryKey: ["m-me"] });
      await qc.invalidateQueries({ queryKey: ["current-member-access"] });
      toast.success("Now viewing as a member");
      navigate({ to: "/m" });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not enter POV");
    } finally {
      setPovBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 md:px-6">
      <PageHeader
        title="Membership Admin Dashboard"
        subtitle="JF Membership signups, subscriptions, setup health & content."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={enterPov} disabled={povBusy} className="bg-emerald-600 hover:bg-emerald-700">
              <Eye className="mr-2 h-4 w-4" /> Enter Membership POV
            </Button>
            <Link to="/admin/membership/action-needed"><Button variant="outline"><AlertCircle className="mr-2 h-4 w-4" />Action Needed</Button></Link>
            <Link to="/admin/membership/onboarding-email"><Button variant="outline"><Mail className="mr-2 h-4 w-4" />Onboarding Email</Button></Link>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
          <Sparkles className="mr-1 h-3 w-3" />JF Membership Mode
        </Badge>
        <span>Switch back to Coaching above to manage coaching clients.</span>
      </div>

      {/* 1. PRIORITY — Actions */}
      <section>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Membership Actions</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <QuickCard to="/admin/members" icon={ShieldCheck} title="Manage Members"
            desc="Search, filter, and manage every JF member." tone="primary" featured />
          <QuickCard to="/admin/membership/action-needed" icon={AlertTriangle} title="Payment Issues"
            desc="Trial ended, failed payments, reactivations." tone="rose" featured />
          <QuickCard to="/admin/members" icon={Gift} title="Grant Access"
            desc="Give complimentary access without Stripe." tone="primary" featured />
          <QuickCard to="/admin/membership/checkout-settings" icon={Package} title="Sales & Plans"
            desc="Plans, pricing, checkout, promotions." featured />
        </div>
      </section>

      {/* 2. SECONDARY — Important alerts */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-bold">
              <AlertTriangle className="h-4 w-4 text-rose-300" />
              Recently expired members
            </h3>
            <Link to="/admin/membership/action-needed" className="text-xs text-primary hover:underline">View all</Link>
          </div>
          {expiredQuery.isLoading ? (
            <div className="text-xs text-muted-foreground">Loading…</div>
          ) : expiredQuery.data?.members?.length ? (
            <ul className="divide-y divide-border text-sm">
              {expiredQuery.data.members.map((m: any) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <Link to="/admin/members/$memberId" params={{ memberId: m.id }} className="block truncate font-medium hover:underline">
                      {m.full_name || m.email}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      Expired {m._expiredAt ? new Date(m._expiredAt).toLocaleDateString() : "—"}
                      {m.subscription_status ? ` · ${m.subscription_status}` : ""}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => onGrant(m.id, m.full_name || m.email)}
                    disabled={grantingId === m.id}
                    className="shrink-0 bg-emerald-600 hover:bg-emerald-700"
                  >
                    <Gift className="mr-1 h-3.5 w-3.5" />
                    {grantingId === m.id ? "Granting…" : "Grant 7 days"}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-muted-foreground">No recently expired members in the last 30 days.</div>
          )}
        </Card>

        <Card className="p-4">
          <h3 className="mb-2 text-sm font-bold">Setup issues</h3>
          <ul className="space-y-1.5 text-sm">
            <AlertRow label="Payment failed / past due" value={c?.past_due ?? 0} icon={CreditCard} tone="rose" to="/admin/membership/action-needed" isLoading={isLoading} />
            <AlertRow label="Incomplete setup" value={c?.incomplete_setup ?? 0} icon={ListChecks} tone="warn" to="/admin/membership/action-needed" isLoading={isLoading} />
            <AlertRow label="Missing profile pic" value={c?.missing_pfp ?? 0} icon={Camera} tone="warn" to="/admin/membership/action-needed" isLoading={isLoading} />
            <AlertRow label="Missing phone" value={c?.missing_phone ?? 0} icon={Phone} to="/admin/membership/action-needed" isLoading={isLoading} />
            <AlertRow label="SMS consent missing" value={c?.missing_sms ?? 0} icon={MessageCircle} to="/admin/membership/action-needed" isLoading={isLoading} />
          </ul>
        </Card>
      </section>

      {/* 3. TERTIARY — More management surfaces */}
      <section>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">More</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <QuickCard to="/admin/membership/promo-tools" icon={Tags} title="Promotions & Referrals"
            desc="Discount and referral codes." />
          <QuickCard to="/admin/membership/sales-page" icon={FileText} title="Sales Page"
            desc="Edit and preview jfeffect.com/join." />
          <QuickCard to="/admin/membership/stripe-sync" icon={Activity} title="Stripe Sync & Health"
            desc="Webhooks, mismatches, manual sync." />
          <QuickCard to="/admin/membership/signup-stats" icon={TrendingUp} title="Signup Stats"
            desc="Growth trends and cohort snapshots." />
        </div>
      </section>

      {/* 4. ANALYTICS — Bottom */}
      <section>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Analytics</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Active" value={isLoading ? "…" : c?.active ?? 0} icon={Users} tone="primary" />
          <Stat label="Trialing" value={isLoading ? "…" : c?.trialing ?? 0} icon={Clock} tone="warn" />
          <Stat label="Past Due" value={isLoading ? "…" : c?.past_due ?? 0} icon={CreditCard} tone="rose" />
          <Stat label="Paused" value={isLoading ? "…" : c?.paused ?? 0} icon={Pause} />
          <Stat label="Hold Plan" value={isLoading ? "…" : c?.hold ?? 0} icon={ListChecks} />
          <Stat label="Cancelled" value={isLoading ? "…" : c?.cancelled ?? 0} icon={XCircle} />
          <Stat label="Access Active" value={isLoading ? "…" : c?.access_active ?? 0} icon={ShieldCheck} tone="primary" to="/admin/members" />
          <Stat label="Access Expired" value={isLoading ? "…" : c?.access_expired ?? 0} icon={AlertTriangle} tone="rose" to="/admin/members" />
          <Stat label="Manual Override" value={isLoading ? "…" : c?.manual_override ?? 0} icon={UserCog} tone="warn" to="/admin/members" />
        </div>
      </section>

      {/* Recent activity */}
      <section className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
        <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold">Recent signups</h3>
            <Link to="/admin/membership/signup-stats" className="text-xs text-primary hover:underline"><TrendingUp className="mr-1 inline h-3 w-3" />View signup stats</Link>
          </div>
          {data?.recentSignups?.length ? (
            <ul className="divide-y divide-border text-sm">
              {data.recentSignups.map((m: any) => (
                <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                  <Link to="/admin/members/$memberId" params={{ memberId: m.id }} className="truncate hover:underline">
                    {m.full_name || m.email}
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">{new Date(m.created_at).toLocaleDateString()}</span>
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
                <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                  <Link to="/admin/members/$memberId" params={{ memberId: m.id }} className="min-w-0 truncate hover:underline">
                    {m.full_name || m.email}
                  </Link>
                  <span className="shrink-0 text-xs text-amber-300">Trial ends {new Date(m.trial_end_at).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          ) : <div className="text-xs text-muted-foreground">No trials ending in the next 7 days.</div>}
        </Card>
      </section>
    </div>
  );
}

function AlertRow({ label, value, icon: Icon, tone = "default", to, isLoading }: { label: string; value: number | string; icon: any; tone?: "default" | "warn" | "rose"; to?: string; isLoading?: boolean }) {
  const dot =
    tone === "rose" ? "text-rose-300" :
    tone === "warn" ? "text-amber-300" :
    "text-muted-foreground";
  const row = (
    <div className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${dot}`} />
        <span className="truncate text-xs">{label}</span>
      </div>
      <span className={`shrink-0 text-sm font-bold ${dot}`}>{isLoading ? "…" : value}</span>
    </div>
  );
  return <li>{to ? <Link to={to as any}>{row}</Link> : row}</li>;
}

function QuickCard({
  to, icon: Icon, title, desc, tone = "default", featured = false,
}: {
  to: string; icon: any; title: string; desc: string;
  tone?: "default" | "primary" | "rose" | "warn"; featured?: boolean;
}) {
  const toneRing =
    tone === "primary" ? "border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/10" :
    tone === "rose" ? "border-rose-500/40 bg-rose-500/5 hover:bg-rose-500/10" :
    tone === "warn" ? "border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10" :
    "border-border bg-card hover:bg-muted/40";
  const iconTone =
    tone === "primary" ? "bg-emerald-500/15 text-emerald-300" :
    tone === "rose" ? "bg-rose-500/15 text-rose-300" :
    tone === "warn" ? "bg-amber-500/15 text-amber-300" :
    "bg-secondary text-foreground";
  return (
    <Link to={to as any}>
      <Card className={`h-full border transition-colors ${toneRing} ${featured ? "p-5" : "p-4"}`}>
        <div className="flex items-start gap-3">
          <div className={`grid shrink-0 place-items-center rounded-md ${iconTone} ${featured ? "h-10 w-10" : "h-9 w-9"}`}>
            <Icon className={featured ? "h-5 w-5" : "h-4 w-4"} />
          </div>
          <div className="min-w-0">
            <div className={`font-bold tracking-tight ${featured ? "text-base" : "text-sm"}`}>{title}</div>
            <div className={`mt-1 text-muted-foreground ${featured ? "text-xs" : "text-[11px]"}`}>{desc}</div>
          </div>
        </div>
      </Card>
    </Link>
  );
}