import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getNativePackage, sealAndSendPackage, voidPackage, generateAgreementPdf, getPdfDownloadUrl } from "@/lib/native-agreements.functions";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useState } from "react";
import { Copy, Download, Send, Ban } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/agreements-native/$packageId")({
  component: NativeAgreementDetail,
});

function NativeAgreementDetail() {
  const { packageId } = useParams({ from: "/_authenticated/admin/agreements-native/$packageId" });
  const fetchPkg = useServerFn(getNativePackage);
  const sendFn = useServerFn(sealAndSendPackage);
  const voidFn = useServerFn(voidPackage);
  const pdfFn = useServerFn(generateAgreementPdf);
  const urlFn = useServerFn(getPdfDownloadUrl);
  const qc = useQueryClient();
  const [links, setLinks] = useState<{ email: string; url: string }[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ["native-package", packageId],
    queryFn: () => fetchPkg({ data: { packageId } }),
  });

  const send = useMutation({
    mutationFn: () => sendFn({ data: { packageId } }),
    onSuccess: (res: any) => {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      setLinks(res.signingLinks.map((l: any) => ({ email: l.email, url: origin + l.signingUrl })));
      toast.success("Sealed and sent. Share the signing links below with each signer.");
      qc.invalidateQueries({ queryKey: ["native-package", packageId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const voidIt = useMutation({
    mutationFn: (reason: string) => voidFn({ data: { packageId, reason } }),
    onSuccess: () => { toast.success("Package voided"); qc.invalidateQueries({ queryKey: ["native-package", packageId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const regenPdf = useMutation({
    mutationFn: () => pdfFn({ data: { packageId } }),
    onSuccess: () => { toast.success("PDF generated"); qc.invalidateQueries({ queryKey: ["native-package", packageId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  async function downloadPdf(documentId: string) {
    try {
      const res = await urlFn({ data: { documentId } });
      window.open(res.url, "_blank");
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  if (isLoading || !data) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  const pkg = data.package as any;
  const canSend = ["draft", "ready"].includes(pkg.status) && pkg.jurisdiction_supported && (pkg.jurisdiction_block_reasons ?? []).length === 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title={pkg.custom_title ?? "Agreement"}
        subtitle={`Client: ${pkg.clients?.first_name} ${pkg.clients?.last_name} · Status: ${pkg.status}`}
        actions={<Link to="/admin/agreements-native"><Button variant="ghost" size="sm">← Back</Button></Link>}
      />

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{pkg.status.replace(/_/g, " ")}</Badge>
          {pkg.contract_value_minor != null && (
            <Badge variant="outline">{new Intl.NumberFormat("en-CA", { style: "currency", currency: pkg.currency ?? "CAD" }).format(pkg.contract_value_minor / 100)}</Badge>
          )}
          {!pkg.jurisdiction_supported && <Badge variant="destructive">Unsupported jurisdiction</Badge>}
          {(pkg.jurisdiction_block_reasons ?? []).map((r: string) => (
            <Badge key={r} variant="destructive">{r.replace(/_/g, " ")}</Badge>
          ))}
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={!canSend || send.isPending} onClick={() => send.mutate()}>
            <Send className="h-4 w-4 mr-1" /> Seal & Send
          </Button>
          {pkg.status === "completed" && (
            <Button size="sm" variant="outline" onClick={() => regenPdf.mutate()} disabled={regenPdf.isPending}>
              Re-generate PDF
            </Button>
          )}
          {!["voided", "completed"].includes(pkg.status) && (
            <Button size="sm" variant="ghost" onClick={() => {
              const r = prompt("Void reason?");
              if (r) voidIt.mutate(r);
            }}>
              <Ban className="h-4 w-4 mr-1" /> Void
            </Button>
          )}
        </div>
      </Card>

      {links.length > 0 && (
        <Card className="p-4 space-y-2">
          <h3 className="font-semibold">Signing links (shown only once)</h3>
          {links.map((l) => (
            <div key={l.email} className="flex items-center gap-2 text-sm">
              <span className="font-mono text-xs flex-1 truncate">{l.email} → {l.url}</span>
              <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(l.url); toast.success("Copied"); }}>
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">These tokens are only shown now. They expire in 14 days.</p>
        </Card>
      )}

      <Card className="p-4">
        <h3 className="font-semibold mb-2">Signers</h3>
        <div className="space-y-1 text-sm">
          {(data.signers as any[]).map((s) => (
            <div key={s.id} className="flex justify-between border-b py-1">
              <span>{s.full_name} <span className="text-muted-foreground">({s.role})</span></span>
              <Badge variant={s.status === "signed" ? "default" : "secondary"}>{s.status}</Badge>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-2">Documents</h3>
        {(data.documents as any[]).length === 0 ? (
          <div className="text-sm text-muted-foreground">No documents generated yet.</div>
        ) : (
          <div className="space-y-1 text-sm">
            {(data.documents as any[]).map((d) => (
              <div key={d.id} className="flex justify-between border-b py-1">
                <span>{d.kind} v{d.document_version} · {d.byte_size ?? 0} bytes</span>
                <Button size="sm" variant="ghost" onClick={() => downloadPdf(d.id)}>
                  <Download className="h-3 w-3 mr-1" /> Download
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-2">Audit events</h3>
        <div className="space-y-1 text-xs font-mono max-h-96 overflow-y-auto">
          {(data.events as any[]).map((e) => (
            <div key={e.id} className="border-b py-1">
              {new Date(e.created_at).toISOString()} · <span className="font-semibold">{e.event_type}</span> · {e.actor_role ?? ""}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}