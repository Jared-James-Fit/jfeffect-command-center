import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { crmDashboardStats } from "@/lib/crm.functions";
import { Flame, Users, ClipboardList, PhoneCall, AlertTriangle, TrendingUp, CheckCircle2, XCircle } from "lucide-react";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/admin/crm/")({
  component: CrmRedirect,
});

function CrmRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/admin/sales", search: { tab: "pipeline" } as any, replace: true });
  }, [navigate]);
  return null;
}

export function CrmDashboard({ embedded = false }: { embedded?: boolean } = {}) {
  const fetchStats = useServerFn(crmDashboardStats);
  const { data } = useQuery({ queryKey: ["crm","dashboard"], queryFn: () => fetchStats(), refetchInterval: 60_000 });
  const s = data?.stats;

  return (
    <div className="space-y-5">
      {!embedded && <PageHeader title="CRM" subtitle="Leads, applicants and conversion pipeline. Active coaching clients are tracked separately." />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
        <StatCard to="/admin/crm/contacts" search={{ scope: "prospects" }} icon={Users} label="Prospects" value={s?.total_prospects ?? 0} />
        <StatCard to="/admin/crm/contacts" search={{ scope: "applicants" }} icon={ClipboardList} label="New apps (7d)" value={s?.new_applications_7d ?? 0} />
        <StatCard to="/admin/crm/contacts" search={{ lead_temperature: "hot", scope: "prospects" }} icon={Flame} label="Hot leads" value={s?.hot_leads ?? 0} tone="text-red-500" />
        <StatCard to="/admin/crm/contacts" search={{ lead_temperature: "warm", scope: "prospects" }} icon={Flame} label="Warm leads" value={s?.warm_leads ?? 0} tone="text-amber-500" />
        <StatCard to="/admin/crm/contacts" search={{ overdue: "true", scope: "prospects" }} icon={AlertTriangle} label="Follow-ups due" value={s?.follow_ups_due ?? 0} />
        <StatCard to="/admin/crm/contacts" search={{ call_booked: "true", scope: "prospects" }} icon={PhoneCall} label="Calls booked" value={s?.calls_booked ?? 0} />
        <StatCard to="/admin/crm/contacts" search={{ scope: "active" }} icon={CheckCircle2} label="Active clients" value={s?.active_clients ?? 0} tone="text-emerald-500" />
        <StatCard to="/admin/crm/contacts" search={{ lifecycle_stage: "won" }} icon={TrendingUp} label="Won (30d)" value={s?.won_30d ?? 0} tone="text-emerald-500" />
        <StatCard to="/admin/crm/contacts" search={{ lifecycle_stage: "lost" }} icon={XCircle} label="Lost (30d)" value={s?.lost_30d ?? 0} tone="text-muted-foreground" />
        <Card className="flex flex-col justify-center p-4">
          <div className="text-xs text-muted-foreground">Conversion rate</div>
          <div className="text-2xl font-bold">{s?.conversion_rate ?? 0}%</div>
          <div className="text-[10px] text-muted-foreground">won / (won + lost)</div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Hot leads needing action">
          {(data?.hot_list ?? []).length === 0 && <Empty>No hot leads.</Empty>}
          {(data?.hot_list ?? []).map((c: any) => (
            <ContactRow key={c.id} c={c} extra={`Score ${c.lead_score ?? "—"}`} />
          ))}
        </Panel>
        <Panel title="Follow-ups overdue">
          {(data?.overdue ?? []).length === 0 && <Empty>Nothing overdue.</Empty>}
          {(data?.overdue ?? []).map((c: any) => (
            <ContactRow key={c.id} c={c} extra={c.next_follow_up_at ? format(new Date(c.next_follow_up_at), "MMM d") : ""} />
          ))}
        </Panel>
        <Panel title="Recent applications">
          {(data?.recent_applications ?? []).length === 0 && <Empty>No recent apps.</Empty>}
          {(data?.recent_applications ?? []).map((a: any) => (
            <Link key={a.id} to={a.client_id ? "/admin/crm/contacts/$id" : "/admin/sales/coaching-applications"} params={a.client_id ? { id: a.client_id } : undefined as any} className="flex items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-muted">
              <div className="min-w-0">
                <div className="truncate font-medium">{a.full_name}</div>
                <div className="truncate text-[11px] text-muted-foreground">{a.email}</div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="outline" className="capitalize">{a.lead_temperature ?? "—"}</Badge>
                <span className="text-muted-foreground">{format(new Date(a.created_at), "MMM d")}</span>
              </div>
            </Link>
          ))}
        </Panel>
        <Panel title="Recently converted">
          {(data?.recently_converted ?? []).length === 0 && <Empty>None yet.</Empty>}
          {(data?.recently_converted ?? []).map((c: any) => (
            <ContactRow key={c.id} c={c} extra={c.converted_to_client_at ? format(new Date(c.converted_to_client_at), "MMM d") : ""} />
          ))}
        </Panel>
      </div>
    </div>
  );
}

function StatCard({ to, search, icon: Icon, label, value, tone }: any) {
  return (
    <Link to={to} search={search as any}>
      <Card className="p-4 transition hover:bg-muted/30">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{label}</span>
          <Icon className={`h-4 w-4 ${tone ?? "text-muted-foreground"}`} />
        </div>
        <div className="mt-1 text-2xl font-bold">{value}</div>
      </Card>
    </Link>
  );
}
function Panel({ title, children }: any) {
  return (
    <Card className="p-4">
      <div className="mb-2 text-sm font-semibold">{title}</div>
      <div className="space-y-1">{children}</div>
    </Card>
  );
}
function Empty({ children }: any) { return <div className="rounded border border-dashed border-border p-3 text-xs text-muted-foreground">{children}</div>; }
function ContactRow({ c, extra }: any) {
  return (
    <Link to="/admin/crm/contacts/$id" params={{ id: c.id }} className="flex items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-muted">
      <div className="min-w-0">
        <div className="truncate font-medium">{c.full_name ?? c.email}</div>
        <div className="truncate text-[11px] text-muted-foreground">{c.email}</div>
      </div>
      <div className="flex items-center gap-2 text-xs">
        {c.lead_temperature && <Badge variant="outline" className="capitalize">{c.lead_temperature}</Badge>}
        <span className="text-muted-foreground">{extra}</span>
      </div>
    </Link>
  );
}