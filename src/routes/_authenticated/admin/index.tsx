import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Users, UserPlus, AlertTriangle, Calendar, DollarSign,
  Plus, Zap, ExternalLink, Activity, Dumbbell, Package, Timer, UserCheck,
} from "lucide-react";
import { derivePhase, displayTitle, toneClasses, type TrainingPhase } from "@/lib/training-phases";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminDashboard,
});

function StatCard({ label, value, icon: Icon, tone = "default" }: { label: string; value: string | number; icon: React.ComponentType<{ className?: string }>; tone?: "default" | "warn" | "primary" }) {
  return (
    <Card className="border-border bg-card p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
          <div className="mt-2 text-3xl font-black tracking-tight">{value}</div>
        </div>
        <div className={`grid h-10 w-10 place-items-center rounded-md ${
          tone === "primary" ? "bg-gradient-primary text-primary-foreground" :
          tone === "warn" ? "bg-warning/15 text-warning" : "bg-secondary text-foreground"
        }`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

function AdminDashboard() {
  const { data: clients = [] } = useQuery({
    queryKey: ["admin-clients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").eq("archived", false);
      if (error) throw error;
      return data;
    },
  });

  const { data: phaseRows = [] } = useQuery({
    queryKey: ["training-phases"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_phases")
        .select("*, clients(id, full_name)")
        .order("end_date", { ascending: true });
      if (error) throw error;
      return data as Array<TrainingPhase & { clients: { id: string; full_name: string } | null }>;
    },
  });

  const deadlines = phaseRows
    .map((r) => ({ ...r, derived: derivePhase(r) }))
    .filter((r) => ["ending-soon", "due-today", "past-due"].includes(r.derived.state))
    .slice(0, 8);

  // Account setup alerts
  const now = Date.now();
  const setupAlerts = clients
    .map((c) => {
      const expired = c.invite_expires_at && new Date(c.invite_expires_at).getTime() < now && !c.account_created_at;
      const notCreated = !c.account_created_at;
      const needsHelp = c.needs_admin_help;
      const recentReset = c.password_reset_sent_at && (now - new Date(c.password_reset_sent_at).getTime()) < 7 * 24 * 60 * 60 * 1000;
      let tone: "warn" | "primary" | "default" | null = null;
      let label = "";
      if (needsHelp) { tone = "warn"; label = "Needs admin help"; }
      else if (expired) { tone = "warn"; label = "Invite expired"; }
      else if (notCreated && c.invite_sent_at) { tone = "primary"; label = "Setup pending"; }
      else if (notCreated && c.email) { tone = "default"; label = "No invite sent"; }
      else if (recentReset) { tone = "primary"; label = "Reset email sent"; }
      return tone ? { ...c, _tone: tone, _label: label } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .slice(0, 8);

  const active = clients.length;
  const newClients = clients.filter((c) => c.status === "New Client").length;
  const overdue = clients.filter((c) => c.status === "Payment Overdue" || c.payment_status === "Overdue").length;
  const needsAttention = clients.filter((c) => c.status === "Needs Attention" || c.status === "Check-In Overdue").length;

  const quickActions = [
    { label: "Add Client", to: "/admin/clients", icon: Plus },
    { label: "Create Offer", to: "/admin/offers", icon: Package },
    { label: "Add Exercise", to: "/admin/exercises", icon: Dumbbell },
    { label: "Quick Sell", to: "/admin/offers", icon: Zap },
  ];

  const shortcuts = [
    { name: "Stripe", url: "https://dashboard.stripe.com" },
    { name: "Google Drive", url: "https://drive.google.com" },
    { name: "Google Sheets", url: "https://sheets.google.com" },
    { name: "Google Calendar", url: "https://calendar.google.com" },
    { name: "Fillout", url: "https://fillout.com" },
    { name: "SignNow", url: "https://signnow.com" },
  ];

  return (
    <>
      <PageHeader
        title="Command Center"
        subtitle="Your coaching business at a glance."
        actions={quickActions.map((a) => (
          <Link key={a.label} to={a.to}>
            <Button variant="outline" size="sm" className="font-semibold">
              <a.icon className="mr-2 h-4 w-4" />{a.label}
            </Button>
          </Link>
        ))}
      />
      <div className="space-y-6 p-6 md:p-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Active Clients" value={active} icon={Users} tone="primary" />
          <StatCard label="New This Period" value={newClients} icon={UserPlus} />
          <StatCard label="Needs Attention" value={needsAttention} icon={AlertTriangle} tone="warn" />
          <StatCard label="Payment Overdue" value={overdue} icon={DollarSign} tone="warn" />
        </div>

        <Card className="border-border bg-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
              <UserCheck className="h-4 w-4" /> Account Setup Alerts
            </h2>
            <Link to="/admin/clients" className="text-xs font-semibold text-primary hover:underline">View all →</Link>
          </div>
          {setupAlerts.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Every client has set up their account. Nice.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {setupAlerts.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="flex items-center gap-3">
                    <Badge
                      variant="outline"
                      className={
                        c._tone === "warn"
                          ? "border-warning/40 bg-warning/10 text-warning"
                          : c._tone === "primary"
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border text-muted-foreground"
                      }
                    >
                      {c._label}
                    </Badge>
                    <Link to="/admin/clients/$id" params={{ id: c.id }} className="text-sm font-semibold hover:underline">
                      {c.full_name}
                    </Link>
                    <span className="text-xs text-muted-foreground">{c.email ?? "no email"}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{c.account_status}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="border-border bg-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
              <Timer className="h-4 w-4" /> Training Phase Deadlines
            </h2>
            <Link to="/admin/training-phases" className="text-xs font-semibold text-primary hover:underline">View all →</Link>
          </div>
          {deadlines.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No phases ending soon. You're ahead.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {deadlines.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className={toneClasses(p.derived.tone)}>{p.derived.label}</Badge>
                    {p.clients && (
                      <Link to="/admin/clients/$id" params={{ id: p.clients.id }} className="text-sm font-semibold hover:underline">
                        {p.clients.full_name}
                      </Link>
                    )}
                    <span className="text-xs text-muted-foreground">{displayTitle(p)}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {p.derived.daysRemaining < 0 ? `${Math.abs(p.derived.daysRemaining)}d past due` : `${p.derived.daysRemaining}d left`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="border-border bg-card p-6 lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Recent Clients</h2>
              <Link to="/admin/clients" className="text-xs font-semibold text-primary hover:underline">View all →</Link>
            </div>
            {clients.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                No clients yet. <Link to="/admin/clients" className="text-primary underline">Add your first client</Link>.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {clients.slice(0, 6).map((c) => (
                  <li key={c.id} className="flex items-center justify-between py-3">
                    <Link to="/admin/clients/$id" params={{ id: c.id }} className="flex items-center gap-3 hover:opacity-80">
                      <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-primary text-xs font-black text-primary-foreground">
                        {c.full_name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-sm font-semibold">{c.full_name}</div>
                        <div className="text-xs text-muted-foreground">{c.coaching_type ?? "—"}</div>
                      </div>
                    </Link>
                    <Badge variant="outline" className="text-xs">{c.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="border-border bg-card p-6">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-widest text-muted-foreground">Quick Tools</h2>
            <div className="grid grid-cols-2 gap-2">
              {shortcuts.map((s) => (
                <a
                  key={s.name}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-md border border-border bg-secondary/40 px-3 py-2.5 text-xs font-semibold transition hover:border-primary hover:bg-secondary"
                >
                  <span>{s.name}</span>
                  <ExternalLink className="h-3 w-3 text-muted-foreground" />
                </a>
              ))}
            </div>
            <Link to="/admin/apps">
              <Button variant="ghost" size="sm" className="mt-4 w-full justify-center">
                <Activity className="mr-2 h-4 w-4" /> View all tools
              </Button>
            </Link>
          </Card>
        </div>
      </div>
    </>
  );
}

void Calendar;