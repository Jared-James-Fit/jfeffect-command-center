import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Download } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { saveAgreementValues, submitAgreement, recordAgreementOpened } from "@/lib/agreements.functions";
import { AgreementSigner } from "@/components/agreement-signer";
import { AgreementStatusBadge } from "@/components/agreement-status-badge";
import type { FieldSnapshot } from "@/lib/agreements";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/portal/agreements/$id")({
  component: PortalSignerPage,
});

function PortalSignerPage() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const save = useServerFn(saveAgreementValues);
  const submit = useServerFn(submitAgreement);
  const opened = useServerFn(recordAgreementOpened);

  const { data: ag } = useQuery({
    queryKey: ["portal-agreement", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("agreements").select("*").eq("id", id).single();
      if (error) throw error;
      return data as any;
    },
  });
  const { data: vals = [] } = useQuery({
    queryKey: ["portal-agreement-values", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("agreement_field_values").select("*").eq("agreement_id", id);
      if (error) throw error;
      return data as any[];
    },
  });
  const { data: pdfBytes } = useQuery({
    queryKey: ["portal-agreement-pdf", ag?.template_pdf_path],
    enabled: !!ag?.template_pdf_path,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from("agreements").download(ag!.template_pdf_path);
      if (error) throw error;
      return await data.arrayBuffer();
    },
  });
  const { data: signedUrl } = useQuery({
    queryKey: ["portal-agreement-signed-url", ag?.signed_pdf_path],
    enabled: !!ag?.signed_pdf_path,
    queryFn: async () => {
      const { data } = await supabase.storage.from("agreements").createSignedUrl(ag!.signed_pdf_path, 3600);
      return data?.signedUrl ?? null;
    },
  });

  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  useEffect(() => {
    if (user?.email && !signerEmail) setSignerEmail(user.email);
    const meta = (user?.user_metadata ?? {}) as any;
    if (meta.full_name && !signerName) setSignerName(meta.full_name);
  }, [user]);
  useEffect(() => { if (ag) opened({ data: { agreement_id: id } }).catch(() => {}); }, [ag?.id]);

  if (!ag || !pdfBytes) {
    return <div className="p-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-1" /> Loading agreement…</div>;
  }

  const fields = (ag.fields_snapshot ?? []) as FieldSnapshot[];
  const initialValues: Record<string, any> = {};
  for (const v of vals) {
    initialValues[v.field_internal_name] = {
      value_text: v.value_text, value_signature_data_url: v.value_signature_data_url,
    };
  }

  const completed = ag.status === "Completed";

  return (
    <div className="space-y-4">
      <Link to="/portal/agreements" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4 mr-1" /> All agreements
      </Link>
      <div className="flex items-center justify-between gap-2">
        <PageHeader title={ag.template_name} subtitle={`Version ${ag.template_version}`} />
        <div className="flex items-center gap-2">
          <AgreementStatusBadge status={ag.status} />
          {signedUrl && (
            <a href={signedUrl} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="outline"><Download className="h-4 w-4 mr-1" /> Signed PDF</Button>
            </a>
          )}
        </div>
      </div>
      <Card className="p-0 overflow-hidden">
        <div className="p-4">
          <AgreementSigner
            pdfBytes={pdfBytes}
            fields={fields}
            signerRole="client"
            signerName={signerName}
            signerEmail={signerEmail}
            onSignerInfoChange={(n, e) => { setSignerName(n); setSignerEmail(e); }}
            initialValues={initialValues}
            readOnly={completed || ag.status === "Cancelled"}
            onSaveDraft={async (values) => {
              const payload = Object.entries(values).map(([internal_name, v]) => {
                const f = fields.find((x) => x.internal_name === internal_name);
                return {
                  internal_name, signer_role: f?.signer_role ?? "client", field_type: f?.field_type ?? "text",
                  value_text: (v as any).value_text ?? null,
                  value_signature_data_url: (v as any).value_signature_data_url ?? null,
                };
              });
              await save({ data: { agreement_id: id, values: payload, signer_name: signerName, signer_email: signerEmail } });
            }}
            onSubmit={async () => {
              await submit({ data: {
                agreement_id: id, signer_role: "client",
                signer_name: signerName, signer_email: signerEmail,
                user_agent: navigator.userAgent.slice(0, 500),
              } });
              toast.success("Agreement submitted");
              qc.invalidateQueries({ queryKey: ["portal-agreement", id] });
              qc.invalidateQueries({ queryKey: ["portal-agreements"] });
            }}
          />
        </div>
      </Card>
    </div>
  );
}