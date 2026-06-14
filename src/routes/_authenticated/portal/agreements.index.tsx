import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/action-button";
import { AgreementStatusBadge } from "@/components/agreement-status-badge";
import { FileText, ExternalLink, CheckCircle2, Download } from "lucide-react";
import type { Agreement } from "@/lib/agreements";
import { useServerFn } from "@tanstack/react-start";
import { getSignedAgreementUrl } from "@/lib/agreements.functions";
import { toast } from "sonner";
import { usePortalUserId } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/portal/agreements/")({
  component: PortalAgreementsPage,
});

function PortalAgreementsPage() {
  const getUrl = useServerFn(getSignedAgreementUrl);
  const portalUserId = usePortalUserId();
  const downloadSigned = async (id: string) => {
    const r: any = await getUrl({ data: { id } });
    if (r?.url) window.open(r.url, "_blank", "noopener,noreferrer");
    else throw new Error("No signed copy available yet.");
  };
  // Defense-in-depth: explicitly scope the query to this user's client row.
  // RLS already enforces this, but an explicit filter prevents any accidental
  // cross-client read if a policy ever regresses.
  const { data: clientRow } = useQuery({
    queryKey: ["portal-agreements-client-id", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () =>
      (await supabase.from("clients").select("id").eq("user_id", portalUserId!).maybeSingle()).data,
  });
  const clientId = clientRow?.id ?? null;
  const { data = [], isLoading } = useQuery({
    queryKey: ["portal-agreements", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase.from("agreements")
        .select("*")
        .eq("client_id", clientId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Agreement[];
    },
  });

  const completedStatuses = ["Signed", "Completed", "Verified"];
  const NEEDS_PRIORITY: Record<string, number> = {
    "Needs Manual Verification": 0,
    "Needs Resend": 1,
    "Manual Action Needed": 2,
    "Waiting on Client": 3,
    "Opened": 4,
    "Sent": 5,
    "Not Sent": 6,
  };
  const needsAction = data
    .filter((a) => !completedStatuses.includes(a.status as string) && !["Cancelled", "Declined", "Expired"].includes(a.status as string))
    .sort((a, b) => {
      const pa = NEEDS_PRIORITY[a.status as string] ?? 99;
      const pb = NEEDS_PRIORITY[b.status as string] ?? 99;
      if (pa !== pb) return pa - pb;
      return (b.sent_at ?? b.created_at ?? "").localeCompare(a.sent_at ?? a.created_at ?? "");
    });
  const completed = data
    .filter((a) => completedStatuses.includes(a.status as string))
    .sort((a, b) => {
      const ta = a.signed_at ?? a.completed_at ?? a.updated_at ?? "";
      const tb = b.signed_at ?? b.completed_at ?? b.updated_at ?? "";
      return tb.localeCompare(ta);
    });

  return (
    <>
      <PageHeader title="Agreements" subtitle="Review and sign your coaching agreements." />
      <div className="p-6 md:p-8 space-y-6">
        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
          <>
            {needsAction.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold text-muted-foreground">Needs your signature</h2>
                {needsAction.map((a) => (
                  <Card key={a.id} className="border-border bg-card p-4 flex items-center gap-3 flex-wrap">
                    <FileText className="h-5 w-5 text-amber-500" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{(a as any).custom_title ?? a.agreement_type ?? a.template_name}</p>
                      <p className="text-xs text-muted-foreground">Sent {a.sent_at ? new Date(a.sent_at).toLocaleDateString() : "—"}</p>
                    </div>
                    <AgreementStatusBadge status={a.status} />
                    {a.signnow_signing_link ? (
                      <Button size="sm" asChild>
                        <a href={a.signnow_signing_link} target="_blank" rel="noreferrer">Review & sign <ExternalLink className="h-3 w-3 ml-1" /></a>
                      </Button>
                    ) : (
                      <Button size="sm" disabled>Waiting on signing link</Button>
                    )}
                  </Card>
                ))}
              </section>
            )}
            {completed.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold text-muted-foreground">Completed</h2>
                {completed.map((a) => (
                  <Card key={a.id} className="border-border bg-card p-4 flex items-center gap-3 flex-wrap">
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{(a as any).custom_title ?? a.agreement_type ?? a.template_name}</p>
                      <p className="text-xs text-muted-foreground">Signed {a.signed_at ? new Date(a.signed_at).toLocaleDateString() : "—"}</p>
                    </div>
                    {a.signed_copy_storage_path ? (
                      <ActionButton size="sm" variant="outline" onAction={() => downloadSigned(a.id)} loadingLabel="Loading…" successLabel="Opened">
                        Download signed copy <Download className="h-3 w-3 ml-1" />
                      </ActionButton>
                    ) : a.signed_copy_url ? (
                      <Button size="sm" variant="outline" asChild>
                        <a href={a.signed_copy_url} target="_blank" rel="noreferrer">View signed copy <ExternalLink className="h-3 w-3 ml-1" /></a>
                      </Button>
                    ) : a.signnow_completed_link ? (
                      <Button size="sm" variant="outline" asChild>
                        <a href={a.signnow_completed_link} target="_blank" rel="noreferrer">Open in SignNow <ExternalLink className="h-3 w-3 ml-1" /></a>
                      </Button>
                    ) : null}
                  </Card>
                ))}
              </section>
            )}
            {data.length === 0 && (
              <Card className="border-border bg-card p-10 text-center text-sm text-muted-foreground">You don't have any agreements yet.</Card>
            )}
          </>
        )}
      </div>
    </>
  );
}