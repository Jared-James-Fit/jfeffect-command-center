import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AgreementStatusBadge } from "@/components/agreement-status-badge";
import { FileText } from "lucide-react";

export const Route = createFileRoute("/_authenticated/portal/agreements")({
  component: PortalAgreementsPage,
});

function PortalAgreementsPage() {
  const { data = [], isLoading } = useQuery({
    queryKey: ["portal-agreements"],
    queryFn: async () => {
      const { data, error } = await supabase.from("agreements")
        .select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const needsAction = data.filter((a: any) => !["Completed", "Cancelled"].includes(a.status));
  const completed = data.filter((a: any) => a.status === "Completed");

  return (
    <div className="space-y-6">
      <PageHeader title="Agreements" subtitle="Review and sign your coaching agreements." />
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <>
          {needsAction.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground mb-2">Action needed</h2>
              <div className="space-y-2">
                {needsAction.map((a: any) => (
                  <Card key={a.id} className="p-4 flex items-center gap-3">
                    <FileText className="h-5 w-5 text-amber-500" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{a.template_name}</p>
                      <p className="text-xs text-muted-foreground">Sent {a.sent_at ? new Date(a.sent_at).toLocaleDateString() : "—"}</p>
                    </div>
                    <AgreementStatusBadge status={a.status} />
                    <Link to="/portal/agreements/$id" params={{ id: a.id }}>
                      <Button size="sm">Review & sign</Button>
                    </Link>
                  </Card>
                ))}
              </div>
            </section>
          )}
          {completed.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground mb-2">Completed</h2>
              <div className="space-y-2">
                {completed.map((a: any) => (
                  <Card key={a.id} className="p-4 flex items-center gap-3">
                    <FileText className="h-5 w-5 text-emerald-500" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{a.template_name}</p>
                      <p className="text-xs text-muted-foreground">Signed {a.completed_at ? new Date(a.completed_at).toLocaleDateString() : "—"}</p>
                    </div>
                    <Link to="/portal/agreements/$id" params={{ id: a.id }}>
                      <Button size="sm" variant="outline">View</Button>
                    </Link>
                  </Card>
                ))}
              </div>
            </section>
          )}
          {data.length === 0 && (
            <Card className="p-6 text-sm text-muted-foreground">You don't have any agreements yet.</Card>
          )}
        </>
      )}
    </div>
  );
}