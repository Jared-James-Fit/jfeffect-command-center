import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Send, Bell, X, Download, Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { sendAgreement, sendReminder, cancelAgreement } from "@/lib/agreements.functions";
import { AgreementStatusBadge } from "@/components/agreement-status-badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/agreements/instance/$id")({
  component: InstancePage,
});

function InstancePage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const send = useServerFn(sendAgreement);
  const remind = useServerFn(sendReminder);
  const cancel = useServerFn(cancelAgreement);

  const { data: ag } = useQuery({
    queryKey: ["agreement-instance", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("agreements")
        .select("*, clients(full_name, email)").eq("id", id).single();
      if (error) throw error;
      return data as any;
    },
  });
  const { data: audit = [] } = useQuery({
    queryKey: ["agreement-audit", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("agreement_audit_log")
        .select("*").eq("agreement_id", id).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const { data: signedUrl } = useQuery({
    queryKey: ["agreement-signed-url", ag?.signed_pdf_path],
    enabled: !!ag?.signed_pdf_path,
    queryFn: async () => {
      const { data } = await supabase.storage.from("agreements").createSignedUrl(ag!.signed_pdf_path, 3600);
      return data?.signedUrl ?? null;
    },
  });

  if (!ag) return <div className="p-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-1" /> Loading…</div>;

  return (
    <div className="space-y-4">
      <Link to="/admin/agreements" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4 mr-1" /> Agreements
      </Link>
      <PageHeader title={ag.template_name} subtitle={`${ag.clients?.full_name ?? "Client"} · v${ag.template_version}`} />

      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <AgreementStatusBadge status={ag.status} />
          {ag.sent_at && <span className="text-xs text-muted-foreground">Sent {new Date(ag.sent_at).toLocaleString()}</span>}
          {ag.completed_at && <span className="text-xs text-emerald-600">Completed {new Date(ag.completed_at).toLocaleString()}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {ag.status === "Not Sent" && (
            <Button size="sm" onClick={async () => { await send({ data: { agreement_id: id } }); qc.invalidateQueries({ queryKey: ["agreement-instance", id] }); toast.success("Sent"); }}>
              <Send className="h-3 w-3 mr-1" /> Send to client
            </Button>
          )}
          {ag.status !== "Completed" && ag.status !== "Cancelled" && (
            <Button size="sm" variant="outline" onClick={async () => { await remind({ data: { agreement_id: id } }); qc.invalidateQueries({ queryKey: ["agreement-instance", id] }); toast.success("Reminder logged"); }}>
              <Bell className="h-3 w-3 mr-1" /> Send reminder
            </Button>
          )}
          {ag.status !== "Completed" && ag.status !== "Cancelled" && (
            <Button size="sm" variant="ghost" onClick={async () => { if (!confirm("Cancel this agreement?")) return; await cancel({ data: { agreement_id: id } }); qc.invalidateQueries({ queryKey: ["agreement-instance", id] }); }}>
              <X className="h-3 w-3 mr-1" /> Cancel
            </Button>
          )}
          {signedUrl && (
            <a href={signedUrl} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="outline"><Download className="h-3 w-3 mr-1" /> Signed PDF</Button>
            </a>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          Signing link: <code className="bg-muted px-1 rounded text-xs">/portal/agreements/{ag.id}</code>
          {ag.signed_pdf_sha256 && <div className="mt-1">SHA-256: <code className="break-all">{ag.signed_pdf_sha256}</code></div>}
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-2">Audit log</h3>
        <ul className="text-xs space-y-1">
          {audit.map((a: any) => (
            <li key={a.id} className="flex justify-between gap-4 border-b py-1">
              <span><b className="text-foreground">{a.event}</b> by {a.actor_role}{a.signer_name ? ` (${a.signer_name})` : ""}</span>
              <span className="text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
            </li>
          ))}
          {audit.length === 0 && <li className="text-muted-foreground">No events yet.</li>}
        </ul>
      </Card>
    </div>
  );
}