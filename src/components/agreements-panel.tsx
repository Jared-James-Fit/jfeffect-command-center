import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Plus, ExternalLink, Copy, ShieldCheck, AlertTriangle, FileText, Send, BellRing, Upload, Trash2, Loader2, UserPlus, Smartphone, RefreshCcw, Download, CheckCircle2, Flag, StickyNote } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { AgreementStatusBadge } from "@/components/agreement-status-badge";
import { fileLabel, AGREEMENT_TYPES, VERIFICATION_BADGE, type Agreement, type AgreementTemplate, type SigningMethod } from "@/lib/agreements";
import {
  createAgreement, updateAgreement, markAgreementSigned, verifyAgreement,
  sendAgreementReminder, cancelAgreement, refreshAgreementStatus, getSignedAgreementUrl,
} from "@/lib/agreements.functions";

export function AgreementsPanel({ clientId, clientName }: { clientId: string; clientName?: string }) {
  const qc = useQueryClient();
  const [sendMode, setSendMode] = useState<null | "invite" | "in-person">(null);
  const [openUpload, setOpenUpload] = useState<Agreement | null>(null);
  const [openVerify, setOpenVerify] = useState<Agreement | null>(null);

  const createFn = useServerFn(createAgreement);
  const updateFn = useServerFn(updateAgreement);
  const markSignedFn = useServerFn(markAgreementSigned);
  const verifyFn = useServerFn(verifyAgreement);
  const reminderFn = useServerFn(sendAgreementReminder);
  const cancelFn = useServerFn(cancelAgreement);
  const refreshFn = useServerFn(refreshAgreementStatus);
  const getSignedUrlFn = useServerFn(getSignedAgreementUrl);

  const { data: agreements = [] } = useQuery({
    queryKey: ["client-agreements", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("agreements")
        .select("*").eq("client_id", clientId).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Agreement[];
    },
  });

  const { data: templates = [] } = useQuery({
    queryKey: ["agreement-templates-active"],
    queryFn: async () => {
      const { data } = await supabase.from("agreement_templates")
        .select("*").eq("archived", false).eq("is_active", true).order("name");
      return (data ?? []) as AgreementTemplate[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["client-agreements", clientId] });

  return (
    <Card className="border-border bg-card p-5 space-y-3 md:col-span-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Agreements (SignNow)</h3>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" onClick={() => setSendMode("invite")}><UserPlus className="h-3.5 w-3.5 mr-1" /> Invite to Sign</Button>
          <Button size="sm" variant="secondary" onClick={() => setSendMode("in-person")}><Smartphone className="h-3.5 w-3.5 mr-1" /> Sign Template</Button>
          <Button size="sm" variant="outline" onClick={() => setOpenUpload({} as any)}>
            <Upload className="h-3.5 w-3.5 mr-1" /> Upload signed copy
          </Button>
        </div>
      </div>

      {agreements.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">No agreements yet. Send one through SignNow or upload an existing signed copy.</p>
      ) : (
        <ul className="space-y-2">
          {agreements.map((a) => (
            <AgreementRow
              key={a.id}
              ag={a}
              onUpdate={async (patch) => { await updateFn({ data: { id: a.id, ...patch } as any }); invalidate(); }}
              onMarkSigned={() => setOpenUpload(a)}
              onVerify={() => setOpenVerify(a)}
              onRemind={async () => { await reminderFn({ data: { id: a.id } }); toast.success("Reminder logged"); invalidate(); }}
              onCancel={async () => {
                if (!confirm("Cancel this agreement?")) return;
                await cancelFn({ data: { id: a.id } }); toast.success("Cancelled"); invalidate();
              }}
              onMarkManuallySent={async () => {
                await updateFn({ data: { id: a.id, status: "Sent", sent_at: new Date().toISOString() } as any });
                toast.success("Marked as manually sent");
                invalidate();
              }}
              onNeedsFollowUp={async () => {
                await updateFn({ data: { id: a.id, status: "Needs Manual Verification" } as any });
                toast.success("Flagged for follow-up");
                invalidate();
              }}
              onRefresh={async () => {
                const r: any = await refreshFn({ data: { id: a.id } });
                if (r?.ok) {
                  toast.success(`Refreshed: ${r.status}`);
                } else {
                  toast.error(r?.reason ?? "Refresh failed");
                }
                invalidate();
              }}
              onDownloadSigned={async () => {
                try {
                  const r: any = await getSignedUrlFn({ data: { id: a.id } });
                  if (r?.url) {
                    window.open(r.url, "_blank", "noopener,noreferrer");
                  } else {
                    toast.error("No signed copy available yet.");
                  }
                } catch (e: any) {
                  toast.error(e?.message ?? "Couldn't fetch signed copy");
                }
              }}
            />
          ))}
        </ul>
      )}

      {/* Send dialog */}
      <SendAgreementDialog
        open={sendMode !== null}
        mode={sendMode ?? "invite"}
        onOpenChange={(o) => !o && setSendMode(null)}
        clientName={clientName}
        templates={templates}
        onSubmit={async (payload) => {
          const ag = await createFn({ data: { client_id: clientId, ...payload } as any });
          const apiErr = (ag as any)?._api_error as string | null | undefined;
          const apiSent = (ag as any)?._api_document_id as string | null | undefined;
          if (payload.signing_method === "Remote Invite") {
            if (apiErr) {
              toast.error(`SignNow invite failed — saved as Manual Action Needed. ${apiErr}`);
            } else if (apiSent) {
              toast.success("SignNow invite sent. Client will receive an email from SignNow.");
            } else {
              toast.success("Invite logged. Open or copy the signing link to send it to the client.");
            }
          } else if (payload.signing_method === "In-Person / iPad" || payload.signing_method === "Kiosk Mode") {
            if (payload.signnow_signing_link) {
              window.open(payload.signnow_signing_link, "_blank", "noopener,noreferrer");
            }
            toast.success("Launched signing session. Mark signed when finished.");
            setOpenUpload(ag as any);
          } else {
            toast.success("Agreement created");
          }
          invalidate(); setSendMode(null);
        }}
      />

      {/* Upload / mark signed dialog */}
      <UploadSignedDialog
        open={!!openUpload}
        onOpenChange={(o) => !o && setOpenUpload(null)}
        clientId={clientId}
        clientName={clientName}
        agreement={openUpload && openUpload.id ? openUpload : null}
        templates={templates}
        onSubmit={async (payload) => {
          if (openUpload && openUpload.id) {
            await markSignedFn({ data: { id: openUpload.id, ...payload } as any });
          } else {
            const ag = await createFn({
              data: {
                client_id: clientId,
                template_id: payload.template_id ?? null,
                agreement_type: payload.agreement_type ?? null,
                offer_name: payload.offer_name ?? null,
                signnow_signing_link: payload.signnow_completed_link ?? null,
                send_now: false,
                admin_notes: payload.admin_notes ?? null,
              } as any,
            });
            await markSignedFn({ data: { id: (ag as any).id, ...payload } as any });
          }
          toast.success("Saved");
          invalidate(); setOpenUpload(null);
        }}
      />

      {/* Manual verification */}
      <VerifyDialog
        open={!!openVerify}
        onOpenChange={(o) => !o && setOpenVerify(null)}
        agreement={openVerify}
        onSubmit={async (note) => {
          if (!openVerify) return;
          await verifyFn({ data: { id: openVerify.id, note } });
          toast.success("Marked manually verified");
          invalidate(); setOpenVerify(null);
        }}
      />
    </Card>
  );
}

function AgreementRow({
  ag, onUpdate, onMarkSigned, onVerify, onRemind, onCancel, onRefresh, onDownloadSigned,
}: {
  ag: Agreement;
  onUpdate: (patch: Partial<Agreement>) => Promise<void> | void;
  onMarkSigned: () => void;
  onVerify: () => void;
  onRemind: () => void;
  onCancel: () => void;
  onRefresh: () => void;
  onDownloadSigned: () => void;
}) {
  const label = useMemo(() => fileLabel({
    clientName: ag.client_full_name ?? ag.correct_client_name ?? "Client",
    agreementType: ag.agreement_type ?? ag.template_name,
    signedAt: ag.signed_at ?? ag.completed_at,
    offerName: ag.offer_name,
  }), [ag]);

  return (
    <li className="rounded-lg border border-border bg-secondary/30 p-3 space-y-2">
      <div className="flex items-start gap-2 flex-wrap">
        <FileText className="h-4 w-4 text-muted-foreground mt-1" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{label}</p>
          <p className="text-xs text-muted-foreground truncate">
            {ag.template_name}{ag.signnow_template_id ? ` · SignNow ID: ${ag.signnow_template_id}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <AgreementStatusBadge status={ag.status} />
          <Badge variant="secondary" className={`border-0 ${VERIFICATION_BADGE[ag.verification_status] ?? "bg-muted text-muted-foreground"}`}>
            {ag.verification_status}
          </Badge>
        </div>
      </div>

      {ag.signer_mismatch && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            Signer name mismatch detected. SignNow showed <strong>{ag.signer_name_in_signnow}</strong> but this agreement belongs to <strong>{ag.correct_client_name}</strong>. Verify before relying on the record.
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 text-xs">
        {ag.signnow_signing_link && (
          <>
            <Button size="sm" variant="outline" asChild>
              <a href={ag.signnow_signing_link} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3 mr-1" />Open signing link</a>
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(ag.signnow_signing_link!); toast.success("Link copied"); }}>
              <Copy className="h-3 w-3 mr-1" />Copy
            </Button>
          </>
        )}
        {ag.signed_copy_url && (
          <Button size="sm" variant="outline" asChild>
            <a href={ag.signed_copy_url} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3 mr-1" />View signed copy</a>
          </Button>
        )}
        {ag.signed_copy_storage_path && (
          <Button size="sm" variant="outline" onClick={onDownloadSigned}><Download className="h-3 w-3 mr-1" />Download signed PDF</Button>
        )}
        {ag.signnow_document_id && (
          <Button size="sm" variant="ghost" onClick={onRefresh}><RefreshCcw className="h-3 w-3 mr-1" />Refresh status</Button>
        )}
        {ag.signnow_completed_link && (
          <Button size="sm" variant="outline" asChild>
            <a href={ag.signnow_completed_link} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3 mr-1" />Open in SignNow</a>
          </Button>
        )}
        {ag.status !== "Verified" && (ag.status === "Signed" || ag.signer_mismatch || ag.verification_status !== "Manually Verified") && (
          <Button size="sm" variant="outline" onClick={onVerify}><ShieldCheck className="h-3 w-3 mr-1" />Mark verified</Button>
        )}
        {!["Signed", "Completed", "Verified", "Cancelled"].includes(ag.status as string) && (
          <>
            <Button size="sm" variant="ghost" onClick={onRemind}><BellRing className="h-3 w-3 mr-1" />Reminder</Button>
            <Button size="sm" variant="ghost" onClick={() => onUpdate({ status: "Needs Resend" })}><Send className="h-3 w-3 mr-1" />Needs resend</Button>
          </>
        )}
        <Button size="sm" variant="ghost" onClick={onMarkSigned}><Upload className="h-3 w-3 mr-1" />Upload/Mark signed</Button>
        {ag.status !== "Cancelled" && (
          <Button size="sm" variant="ghost" onClick={onCancel}><Trash2 className="h-3 w-3 mr-1" />Cancel</Button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-muted-foreground pt-1">
        <div>Sent: {ag.sent_at ? new Date(ag.sent_at).toLocaleDateString() : "—"}</div>
        <div>Signed: {ag.signed_at ? new Date(ag.signed_at).toLocaleString() : "—"}</div>
        <div>Type: {ag.agreement_type ?? "—"}</div>
        <div>Offer: {ag.offer_name ?? "—"}</div>
      </div>
    </li>
  );
}

function SendAgreementDialog({
  open, mode, onOpenChange, templates, clientName, onSubmit,
}: {
  open: boolean;
  mode: "invite" | "in-person";
  onOpenChange: (o: boolean) => void;
  templates: AgreementTemplate[];
  clientName?: string;
  onSubmit: (payload: {
    template_id?: string | null;
    agreement_type?: string | null;
    signnow_signing_link?: string | null;
    offer_name?: string | null;
    send_now: boolean;
    admin_notes?: string | null;
    signing_method: SigningMethod;
  }) => Promise<void>;
}) {
  const [templateId, setTemplateId] = useState<string>("");
  const [agreementType, setAgreementType] = useState<string>("");
  const [link, setLink] = useState("");
  const [offerName, setOfferName] = useState("");
  const [notes, setNotes] = useState("");
  const [kiosk, setKiosk] = useState(false);
  const [busy, setBusy] = useState(false);

  const tpl = templates.find((t) => t.id === templateId);
  const inPerson = mode === "in-person";
  const signingMethod: SigningMethod = inPerson
    ? (kiosk ? "Kiosk Mode" : "In-Person / iPad")
    : "Remote Invite";

  async function go() {
    const finalLink = link.trim() || tpl?.signnow_url || null;
    if (!templateId && !finalLink) {
      toast.error("Pick a template or paste a SignNow signing link");
      return;
    }
    if (inPerson && !finalLink) {
      toast.error("Need a SignNow signing link to launch in-person signing");
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        template_id: templateId || null,
        agreement_type: agreementType || tpl?.agreement_type || null,
        signnow_signing_link: finalLink,
        offer_name: offerName.trim() || null,
        admin_notes: notes.trim() || null,
        send_now: true,
        signing_method: signingMethod,
      });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{inPerson ? "Sign Template — In-Person / iPad" : "Invite to Sign — Remote"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {clientName && (
            <p className="text-xs text-muted-foreground">
              Client: <strong className="text-foreground">{clientName}</strong>
              {inPerson && " — they will sign on your device. The signed record will be attached to this client even if SignNow shows your name."}
            </p>
          )}
          <div>
            <Label className="text-xs">Template</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger><SelectValue placeholder="Pick a SignNow template" /></SelectTrigger>
              <SelectContent>
                {templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}{t.agreement_type ? ` — ${t.agreement_type}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            {templates.length === 0 && <p className="text-[11px] text-muted-foreground mt-1">No templates yet. Add one in Agreements → Templates.</p>}
          </div>
          <div>
            <Label className="text-xs">Agreement type (override)</Label>
            <Select value={agreementType} onValueChange={setAgreementType}>
              <SelectTrigger><SelectValue placeholder={tpl?.agreement_type ?? "From template"} /></SelectTrigger>
              <SelectContent>
                {AGREEMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">SignNow signing link</Label>
            <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder={tpl?.signnow_url ?? "https://app.signnow.com/..."} />
            <p className="text-[11px] text-muted-foreground mt-1">
              {inPerson
                ? "We'll open this link in a new tab so the client can sign on this device, then prompt you to mark it signed."
                : "Paste the signing link from your SignNow template. We'll save it on the record so you can copy/send it from the agreement row."}
            </p>
          </div>
          <div>
            <Label className="text-xs">Connect to offer / purchase (optional)</Label>
            <Input value={offerName} onChange={(e) => setOfferName(e.target.value)} placeholder="e.g. 6 Month Online Coaching" />
          </div>
          <div>
            <Label className="text-xs">Internal admin notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {inPerson && (
            <div className="flex items-center justify-between rounded-md border border-border bg-secondary/30 p-2">
              <div>
                <Label className="text-xs">Treat as Kiosk Mode</Label>
                <p className="text-[11px] text-muted-foreground">SignNow may show your name as the signer — record will still attach to {clientName ?? "this client"}.</p>
              </div>
              <Switch checked={kiosk} onCheckedChange={setKiosk} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={go} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {inPerson ? "Launch signing" : "Create invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UploadSignedDialog({
  open, onOpenChange, clientId, clientName, agreement, templates, onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
  clientName?: string;
  agreement: Agreement | null;
  templates: AgreementTemplate[];
  onSubmit: (payload: {
    template_id?: string | null; agreement_type?: string | null; offer_name?: string | null;
    signnow_completed_link?: string | null; signnow_document_id?: string | null;
    signer_name_in_signnow?: string | null; signed_at?: string;
    signed_copy_url?: string | null; signed_copy_storage_path?: string | null;
    admin_notes?: string | null;
  }) => Promise<void>;
}) {
  const [templateId, setTemplateId] = useState(agreement?.template_id ?? "");
  const [agreementType, setAgreementType] = useState(agreement?.agreement_type ?? "");
  const [offerName, setOfferName] = useState(agreement?.offer_name ?? "");
  const [completedLink, setCompletedLink] = useState(agreement?.signnow_completed_link ?? "");
  const [docId, setDocId] = useState(agreement?.signnow_document_id ?? "");
  const [signerName, setSignerName] = useState(agreement?.signer_name_in_signnow ?? "");
  const [signedDate, setSignedDate] = useState(new Date().toISOString().slice(0, 16));
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    try {
      let signedUrl: string | null = null;
      let signedPath: string | null = null;
      if (file) {
        const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `signed/${clientId}/${Date.now()}_${cleanName}`;
        const up = await supabase.storage.from("agreements").upload(path, file, {
          contentType: file.type || "application/pdf", upsert: false,
        });
        if (up.error) throw up.error;
        signedPath = path;
        const { data: pub } = await supabase.storage.from("agreements").createSignedUrl(path, 60 * 60 * 24 * 365);
        signedUrl = pub?.signedUrl ?? null;
      }
      await onSubmit({
        template_id: templateId || null,
        agreement_type: agreementType || null,
        offer_name: offerName || null,
        signnow_completed_link: completedLink.trim() || null,
        signnow_document_id: docId.trim() || null,
        signer_name_in_signnow: signerName.trim() || null,
        signed_at: new Date(signedDate).toISOString(),
        signed_copy_url: signedUrl,
        signed_copy_storage_path: signedPath,
        admin_notes: notes.trim() || null,
      });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{agreement?.id ? "Mark agreement signed" : "Upload signed agreement"}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          {!agreement?.id && (
            <>
              <div>
                <Label className="text-xs">Template (optional)</Label>
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger><SelectValue placeholder="Pick a template" /></SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Agreement type</Label>
                <Select value={agreementType} onValueChange={setAgreementType}>
                  <SelectTrigger><SelectValue placeholder="Choose type" /></SelectTrigger>
                  <SelectContent>
                    {AGREEMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Offer / purchase name (optional)</Label>
                <Input value={offerName} onChange={(e) => setOfferName(e.target.value)} />
              </div>
            </>
          )}

          <div>
            <Label className="text-xs">Signed date / time</Label>
            <Input type="datetime-local" value={signedDate} onChange={(e) => setSignedDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">SignNow completed document link (optional)</Label>
            <Input value={completedLink} onChange={(e) => setCompletedLink(e.target.value)} placeholder="https://app.signnow.com/document/..." />
          </div>
          <div>
            <Label className="text-xs">SignNow document ID (optional)</Label>
            <Input value={docId} onChange={(e) => setDocId(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Signer name shown in SignNow</Label>
            <Input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder={clientName ?? "e.g. coach name if kiosk mode"} />
            <p className="text-[11px] text-muted-foreground mt-1">
              If this doesn't match <strong>{clientName ?? "the client"}</strong>, the agreement will be flagged for manual verification — it won't be lost.
            </p>
          </div>
          <div>
            <Label className="text-xs">Upload signed PDF (optional)</Label>
            <Input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div>
            <Label className="text-xs">Internal notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={go} disabled={busy}>{busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Save signed agreement</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VerifyDialog({
  open, onOpenChange, agreement, onSubmit,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  agreement: Agreement | null;
  onSubmit: (note: string) => Promise<void>;
}) {
  const defaultNote = agreement
    ? `Signed in SignNow${agreement.signer_mismatch ? " kiosk mode. SignNow displayed " + (agreement.signer_name_in_signnow ?? "another name") + ", but agreement was completed for " + (agreement.correct_client_name ?? "this client") + " and is attached to the correct client profile." : ". Verified by admin."}`
    : "";
  const [note, setNote] = useState(defaultNote);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setNote(defaultNote); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Mark agreement manually verified</DialogTitle></DialogHeader>
        <Textarea rows={5} value={note} onChange={(e) => setNote(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={async () => { setBusy(true); try { await onSubmit(note); } finally { setBusy(false); } }} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Confirm verified
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}