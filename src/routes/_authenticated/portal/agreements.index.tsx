import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AgreementStatusBadge } from "@/components/agreement-status-badge";
import { FileText, ExternalLink, CheckCircle2, Download } from "lucide-react";
import type { Agreement } from "@/lib/agreements";
import { useServerFn } from "@tanstack/react-start";
import { getSignedAgreementUrl } from "@/lib/agreements.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/portal/agreements/")({
  component: PortalAgreementsPage,
});

function PortalAgreementsPage() {
  const getUrl = useServerFn(getSignedAgreementUrl);
  const downloadSigned = async (id: string) => {
    try {
      const r: any = await getUrl({ data: { id } });
      if (r?.url) window.open(r.url, "_blank", "noopener,noreferrer");
      else toast.error("No signed copy available yet.");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't fetch signed copy");
    }
  };
  const { data = [], isLoading } = useQuery({
    queryKey: ["portal-agreements"],
    queryFn: async () => {
      const { data, error } = await supabase.from("agreements")
        .select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Agreement[];
    },
  });

  const completedStatuses = ["Signed", "Completed", "Verified"];
  const needsAction = data.filter((a) => !completedStatuses.includes(a.status as string) && !["Cancelled", "Declined"].includes(a.status as string));
  const completed = data.filter((a) => completedStatuses.includes(a.status as string));

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
                      <p className="font-semibold truncate">{a.agreement_type ?? a.template_name}</p>
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
                      <p className="font-semibold truncate">{a.agreement_type ?? a.template_name}</p>
                      <p className="text-xs text-muted-foreground">Signed {a.signed_at ? new Date(a.signed_at).toLocaleDateString() : "—"}</p>
                    </div>
                    {a.signed_copy_storage_path ? (
                      <Button size="sm" variant="outline" onClick={() => downloadSigned(a.id)}>
                        Download signed copy <Download className="h-3 w-3 ml-1" />
                      </Button>
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