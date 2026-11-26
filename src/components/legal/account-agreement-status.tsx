import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { previewMembershipAgreement } from "@/lib/membership-agreement.functions";
import { previewLegalStatus, previewAcceptanceHistory } from "@/lib/legal.functions";
import { MEMBERSHIP_AGREEMENT_SLUG } from "@/lib/membership-agreement/acks";

export function useProfileMembershipAgreement(clientId: string, enabled: boolean) {
  const read = useServerFn(previewMembershipAgreement);
  return useQuery({ queryKey: ["membership-agreement", "profile", clientId], enabled, queryFn: () => read({ data: { clientId } }), staleTime: 0, refetchOnWindowFocus: true });
}

export function AccountAgreementStatus({ clientId, linked }: { clientId: string; linked: boolean }) {
  const member = useProfileMembershipAgreement(clientId, linked);
  const read = useServerFn(previewLegalStatus);
  const historyRead = useServerFn(previewAcceptanceHistory);
  const docs = useQuery({ queryKey: ["legal-status", "profile", clientId], enabled: linked, queryFn: () => read({ data: { clientId } }), staleTime: 0 });
  const history = useQuery({ queryKey: ["legal-history", "profile", clientId], enabled: linked, queryFn: () => historyRead({ data: { clientId } }), staleTime: 0 });
  const m = member.data;
  const date = (value: string) => new Date(value).toLocaleString();
  const status = (accepted: boolean, required: boolean) => <Badge variant="outline">{accepted ? "Accepted" : required ? "Required" : "Not accepted"}</Badge>;
  return <Card className="md:col-span-3 space-y-3 p-4">
    <h3 className="text-sm font-semibold">Agreements</h3>
    {!linked ? <p className="text-xs text-muted-foreground">Account not linked yet.</p> : member.isError || docs.isError || history.isError ? <div className="flex items-center justify-between gap-2"><p className="text-xs text-muted-foreground">Could not verify all agreement records.</p><Button variant="outline" size="sm" onClick={() => { void member.refetch(); void docs.refetch(); void history.refetch(); }}>Retry</Button></div> : !member.data || !docs.data || !history.data ? <p className="text-xs text-muted-foreground">Checking agreements…</p> : <>
      {m?.applicable && <div className="flex items-center justify-between gap-3 border-t pt-3"><div><p className="text-sm font-medium">{m.version.title}</p><p className="text-xs text-muted-foreground">Version {m.version.version_number}{m.signedAt ? ` · Accepted v${m.acceptedVersionNumber ?? m.version.version_number} · ${date(m.signedAt)}` : !m.needsSigning && m.acceptedAt ? ` · ${date(m.acceptedAt)}` : ""}</p></div>{status(!m.needsSigning && !!(m.signedAt || m.acceptedAt), m.needsSigning)}</div>}
      {docs.data.filter(d => d.slug !== MEMBERSHIP_AGREEMENT_SLUG && !d.emergency_disabled && !d.is_optional_consent && d.is_required).map(d => <div key={d.document_id} className="flex items-center justify-between gap-3 border-t pt-3"><div><p className="text-sm font-medium">{d.title}</p><p className="text-xs text-muted-foreground">Version {d.version.version_number}{d.accepted_at ? ` · ${date(d.accepted_at)}` : d.satisfied_by_prior_version ? " · Prior acceptance remains valid" : ""}</p></div>{status(!!d.accepted_at || d.satisfied_by_prior_version, d.is_required)}</div>)}
      <details className="border-t pt-3"><summary className="cursor-pointer text-sm font-medium">Acceptance history ({history.data.length})</summary><div className="mt-2 space-y-2">{history.data.map((h: any) => <div key={h.id} className="flex flex-wrap justify-between gap-1 text-xs text-muted-foreground"><span>{h.document?.title ?? "Agreement"} · v{h.version?.version_number ?? "—"}{h.revoked_at ? " · Revoked" : h.context_ref === "member_app" ? " · In app" : ""}</span><span>{date(h.accepted_at)}</span></div>)}{!history.data.length && <p className="text-xs text-muted-foreground">No acceptance records yet.</p>}</div></details>
    </>}
  </Card>;
}
