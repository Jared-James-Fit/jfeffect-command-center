import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, History } from "lucide-react";
import { getCompletedHistory } from "@/lib/pl-programs";
import { ProgressComparison } from "@/components/progress-comparison";

export const Route = createFileRoute("/_authenticated/admin/client-programs/$clientId/history")({ component: HistoryPage });

function HistoryPage() {
  const { clientId } = Route.useParams();
  const { data: client } = useQuery({
    queryKey: ["client", clientId],
    queryFn: async () => (await supabase.from("clients").select("id, full_name").eq("id", clientId).maybeSingle()).data,
  });
  const { data: history } = useQuery({
    queryKey: ["pl-history", clientId],
    queryFn: () => getCompletedHistory(clientId),
  });
  const preps = history?.preps ?? [];
  const blocks = history?.blocks ?? [];

  return (
    <>
      <PageHeader title="Program History" subtitle={client?.full_name ?? ""} />
      <div className="p-6 md:p-8 space-y-6">
        <Link to="/admin/client-programs/$clientId" params={{ clientId }} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to programs
        </Link>

        <section>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-muted-foreground">Compare Progress</h2>
          <ProgressComparison clientId={clientId} />
        </section>

        <section>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-muted-foreground">Completed Preps</h2>
          {preps.length === 0 ? <Card className="p-6 text-sm text-muted-foreground">No completed preps yet.</Card> : (
            <div className="grid gap-2 md:grid-cols-2">
              {preps.map((p: any) => (
                <Card key={p.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-bold">{p.title}</div>
                      <div className="text-xs text-muted-foreground">{p.goal_type}</div>
                      {p.event_name && <div className="mt-1 text-xs">{p.event_name} · {p.event_date}</div>}
                    </div>
                    <Badge variant="outline">{p.status}</Badge>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-muted-foreground">Completed Blocks</h2>
          {blocks.length === 0 ? <Card className="p-6 text-sm text-muted-foreground">No completed blocks yet.</Card> : (
            <div className="grid gap-2">
              {blocks.map((b: any) => (
                <Link key={b.id} to="/admin/blocks/$blockId" params={{ blockId: b.id }}>
                  <Card className="p-3 flex items-center justify-between hover:bg-secondary/30">
                    <div>
                      <div className="font-bold">{b.name}</div>
                      <div className="text-xs text-muted-foreground">{b.weeks} weeks · {b.training_focus ?? "—"}</div>
                    </div>
                    <Badge variant="outline">{b.status}</Badge>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}