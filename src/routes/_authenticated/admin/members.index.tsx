import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMembers } from "@/lib/members.functions";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, UserPlus } from "lucide-react";
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ACCOUNT_TYPES } from "@/lib/membership";

export const Route = createFileRoute("/_authenticated/admin/members/")({ component: MembersList });

const SUB_STATUS_TONE: Record<string, string> = {
  "Trialing":       "bg-amber-500/10 text-amber-300 border-amber-500/30",
  "Active":         "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  "Past Due":       "bg-rose-500/10 text-rose-300 border-rose-500/30",
  "Payment Failed": "bg-rose-500/10 text-rose-300 border-rose-500/30",
  "Paused":         "bg-sky-500/10 text-sky-300 border-sky-500/30",
  "Hold Plan":      "bg-violet-500/10 text-violet-300 border-violet-500/30",
  "Cancelled":      "bg-zinc-500/10 text-zinc-300 border-zinc-500/30",
  "Expired":        "bg-zinc-500/10 text-zinc-300 border-zinc-500/30",
};

function fmtDate(d: string | null | undefined) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString(); } catch { return null; }
}

function MembersList() {
  const fetch = useServerFn(listMembers);
  const [tab, setTab] = useState<string>("all");

  const { data: all } = useQuery({ queryKey: ["admin-members", tab], queryFn: () => {
    if (tab === "all") return fetch({ data: {} });
    if (tab === "jf_member") return fetch({ data: { accountType: "jf_member" } });
    if (tab === "app_member") return fetch({ data: { accountType: "app_member" } });
    if (tab === "program_only") return fetch({ data: { accountType: "program_only" } });
    if (tab === "trialing") return fetch({ data: {} });
    if (tab === "past_due") return fetch({ data: {} });
    if (tab === "deactivated") return fetch({ data: { status: "Deactivated" } });
    if (tab === "archived") return fetch({ data: { status: "Archived" } });
    return fetch({ data: {} });
  } });

  const allMembers = all?.members ?? [];
  const members = (() => {
    if (tab === "trialing") return allMembers.filter((m: any) => m.subscription_status === "Trialing");
    if (tab === "past_due") return allMembers.filter((m: any) =>
      ["Past Due", "Payment Failed"].includes(m.subscription_status || ""));
    return allMembers;
  })();

  return (
    <div className="space-y-5">
      <PageHeader
        title="App Members"
        subtitle="Subscription and program-only members. Separate from coaching clients."
        actions={
          <Link to="/admin/members/new"><Button><UserPlus className="mr-2 h-4 w-4" />New App Member</Button></Link>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="jf_member">JF Membership</TabsTrigger>
          <TabsTrigger value="trialing">Trialing</TabsTrigger>
          <TabsTrigger value="past_due">Billing Issue</TabsTrigger>
          <TabsTrigger value="app_member">App Members</TabsTrigger>
          <TabsTrigger value="program_only">Program-Only</TabsTrigger>
          <TabsTrigger value="deactivated">Deactivated</TabsTrigger>
          <TabsTrigger value="archived">Archived</TabsTrigger>
        </TabsList>
        <TabsContent value={tab}>
          <Card className="mt-3 divide-y">
            {members.length === 0 && <div className="p-6 text-sm text-muted-foreground">No members yet.</div>}
            {members.map((m: any) => (
              <Link key={m.id} to="/admin/members/$memberId" params={{ memberId: m.id }} className="block p-4 hover:bg-muted/40">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{m.full_name || m.email}</div>
                    <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                    {m.account_type === "jf_member" && (
                      <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                        {m.subscription_status === "Trialing" && fmtDate(m.trial_end_at) && (
                          <span>Trial ends {fmtDate(m.trial_end_at)}</span>
                        )}
                        {fmtDate(m.current_period_end) && (
                          <span>Next bill {fmtDate(m.current_period_end)}</span>
                        )}
                        {fmtDate(m.cancel_at) && (
                          <span className="text-amber-300">Cancels {fmtDate(m.cancel_at)}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30 text-[10px] font-bold uppercase tracking-wider">
                      JF
                    </Badge>
                    <Badge variant="outline" className={(ACCOUNT_TYPES as any)[m.account_type]?.tone}>
                      {(ACCOUNT_TYPES as any)[m.account_type]?.label ?? m.account_type}
                    </Badge>
                    {m.account_type === "jf_member" && m.subscription_status && (
                      <Badge variant="outline" className={SUB_STATUS_TONE[m.subscription_status] ?? ""}>
                        {m.subscription_status}
                      </Badge>
                    )}
                    <Badge variant={m.status === "Active" ? "default" : "secondary"}>{m.status}</Badge>
                    {!m.user_id && <Badge variant="outline">Setup pending</Badge>}
                  </div>
                </div>
              </Link>
            ))}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}