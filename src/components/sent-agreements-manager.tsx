import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertTriangle, BadgeCheck, BellRing, CheckCircle2, Copy, Download, ExternalLink, FileText,
  Flag, Inbox, Loader2, Search, Send, ShieldCheck, StickyNote, Upload, User, RefreshCcw,
} from "lucide-react";
import { toast } from "sonner";
import { AgreementStatusBadge } from "@/components/agreement-status-badge";
import {
  agreementNeedsAttention, AGREEMENT_STATUSES, VERIFICATION_BADGE, type Agreement,
} from "@/lib/agreements";
import {
  approveSignedAgreement, markAgreementSigned, verifyAgreement, setAgreementVerification, sendAgreementReminder,
  updateAgreement, refreshAgreementStatus, getSignedAgreementUrl,
} from "@/lib/agreements.functions";

type Row = Agreement & { clients?: { id: string; full_name: string | null; email: string | null } | null };

const STATUS_FILTERS: Array<{ value: string; label: string; match: (a: Agreement) => boolean }> = [
  { value: "all", label: "All", match: () => true },
  { value: "attention", label: "Needs Attention", match: agreementNeedsAttention },
  { value: "waiting", label: "Waiting on Client", match: (a) => ["Sent", "Opened", "Waiting on Client", "Needs Resend", "Manual Action Needed"].includes(a.status as string) },
  { value: "signed", label: "Signed", match: (a) => ["Signed", "Completed"].includes(a.status as string) },
  { value: "verification", label: "Needs Verification", match: (a) => a.status === "Needs Manual Verification" || a.verification_status === "Needs Review" || a.signer_mismatch === true },
  { value: "completed", label: "Completed / Verified", match: (a) => ["Completed", "Verified"].includes(a.status as string) },
  { value: "error", label: "Error / Cancelled", match: (a) => ["Error", "Cancelled", "Expired", "Declined"].includes(a.status as string) },
];

export function SentAgreementsManager() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [templateFilter, setTemplateFilter] = useState<string>("all");
  const [confirming, setConfirming] = useState<Row | null>(null);
  const [noteOpen, setNoteOpen] = useState<Row | null>(null);
  const [uploadOpen, setUploadOpen] = useState<Row | null>(null);

  const verifyFn = useServerFn(verifyAgreement);
  const setVerificationFn = useServerFn(setAgreementVerification);
  const reminderFn = useServerFn(sendAgreementReminder);
  const updateFn = useServerFn(updateAgreement);
  const refreshFn = useServerFn(refreshAgreementStatus);
  const getSignedUrlFn = useServerFn(getSignedAgreementUrl);

  const { data: agreements = [] } = useQuery({
    queryKey: ["all-agreements-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agreements")
        .select("*, clients(id, full_name, email)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["all-agreements-admin"] });
    qc.invalidateQueries({ queryKey: ["client-agreements"] });
  };

  const templateNames = useMemo(() => {
    const set = new Set<string>();
    for (const a of agreements) if (a.template_name) set.add(a.template_name);
    return Array.from(set).sort();
  }, [agreements]);

  const filtered = useMemo(() => {
    const f = STATUS_FILTERS.find((s) => s.value === statusFilter) ?? STATUS_FILTERS[0];
    const q = search.trim().toLowerCase();
    return agreements.filter((a) => {
      if (!f.match(a)) return false;
      if (templateFilter !== "all" && a.template_name !== templateFilter) return false;
      if (q) {
        const hay = `${a.clients?.full_name ?? ""} ${a.clients?.email ?? ""} ${a.template_name ?? ""} ${a.agreement_type ?? ""} ${a.offer_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [agreements, statusFilter, templateFilter, search]);

  const attention = useMemo(() => agreements.filter(agreementNeedsAttention).slice(0, 25), [agreements]);

  const handleRefresh = async (a: Row) => {
    try {
      const r: any = await refreshFn({ data: { id: a.id } });
      if (r?.ok) toast.success(`Refreshed: ${r.status}`);
      else toast.error(r?.reason ?? "Refresh failed");
      invalidate();
    } catch (e: any) {
      toast.error(e?.message ?? "Refresh failed");
    }
  };

  const handleDownload = async (a: Row) => {
    try {
      const r: any = await getSignedUrlFn({ data: { id: a.id } });
      if (r?.url) window.open(r.url, "_blank", "noopener,noreferrer");
      else toast.error("No signed copy available.");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't fetch signed copy");
    }
  };

  const handleVerify = async (a: Row) => {
    if (!confirm(`Mark this agreement for ${a.clients?.full_name ?? "client"} as Manually Verified?`)) return;
    await verifyFn({ data: { id: a.id, note: "Verified from main Agreements page." } });
    toast.success("Marked verified");
    invalidate();
  };

  const handleToggleVerification = async (a: Row, nextVerified: boolean) => {
    if (!nextVerified) {
      if (!confirm("Remove verification? This agreement will be marked as needing attention again and may reappear on the client dashboard.")) return;
    }
    try {
      const r: any = await setVerificationFn({ data: { id: a.id, verified: nextVerified } });
      if (nextVerified) toast.success("Marked verified");
      else toast.success(`Verification removed · ${r?.newStatus ?? "Needs attention"}`);
      invalidate();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't update verification");
    }
  };

  const handleRemind = async (a: Row) => {
    await reminderFn({ data: { id: a.id } });
    toast.success("Reminder logged");
    invalidate();
  };

  const handleNeedsResend = async (a: Row) => {
    await updateFn({ data: { id: a.id, status: "Needs Resend" } as any });
    toast.success("Marked as needs resend");
    invalidate();
  };

  return (
    <>
      {attention.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <h2 className="text-sm font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">
              Agreements Needing Attention ({attention.length})
            </h2>
          </div>
          <ul className="space-y-2">
            {attention.map((a) => (
              <AgreementRow
                key={a.id}
                a={a}
                compact
                onConfirm={() => setConfirming(a)}
                onUpload={() => setUploadOpen(a)}
                onVerify={() => handleVerify(a)}
                onToggleVerification={(v) => handleToggleVerification(a, v)}
                onRemind={() => handleRemind(a)}
                onResend={() => handleNeedsResend(a)}
                onRefresh={() => handleRefresh(a)}
                onDownload={() => handleDownload(a)}
                onAddNote={() => setNoteOpen(a)}
              />
            ))}
          </ul>
        </Card>
      )}

      <Card className="border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
              Sent / Pending Agreements
            </h2>
            <Badge variant="outline" className="text-[10px]">{filtered.length}</Badge>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-4">
          <div className="relative md:col-span-2">
            <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input className="pl-7" placeholder="Search client, email, template, offer…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={templateFilter} onValueChange={setTemplateFilter}>
            <SelectTrigger><SelectValue placeholder="Template" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All templates</SelectItem>
              {templateNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No agreements match these filters. Sent agreements show up here as soon as you invite or upload one.
          </p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((a) => (
              <AgreementRow
                key={a.id}
                a={a}
                onConfirm={() => setConfirming(a)}
                onUpload={() => setUploadOpen(a)}
                onVerify={() => handleVerify(a)}
                onToggleVerification={(v) => handleToggleVerification(a, v)}
                onRemind={() => handleRemind(a)}
                onResend={() => handleNeedsResend(a)}
                onRefresh={() => handleRefresh(a)}
                onDownload={() => handleDownload(a)}
                onAddNote={() => setNoteOpen(a)}
              />
            ))}
          </ul>
        )}
      </Card>

      <ConfirmSignedDialog
        open={!!confirming}
        agreement={confirming}
        onOpenChange={(o) => !o && setConfirming(null)}
        onDone={() => { setConfirming(null); invalidate(); }}
      />
      <UploadSignedCopyDialog
        open={!!uploadOpen}
        agreement={uploadOpen}
        onOpenChange={(o) => !o && setUploadOpen(null)}
        onDone={() => { setUploadOpen(null); invalidate(); }}
      />
      <AddNoteDialog
        open={!!noteOpen}
        agreement={noteOpen}
        onOpenChange={(o) => !o && setNoteOpen(null)}
        onDone={() => { setNoteOpen(null); invalidate(); }}
      />
    </>
  );
}

function AgreementRow({
  a, compact, onConfirm, onUpload, onVerify, onToggleVerification, onRemind, onResend, onRefresh, onDownload, onAddNote,
}: {
  a: Row; compact?: boolean;
  onConfirm: () => void; onUpload: () => void; onVerify: () => void;
  onToggleVerification: (next: boolean) => void;
  onRemind: () => void;
  onResend: () => void; onRefresh: () => void; onDownload: () => void; onAddNote: () => void;
}) {
  const isTerminal = ["Verified", "Completed", "Cancelled"].includes(a.status as string);
  const hasSignedCopy = !!a.signed_copy_url || !!a.signed_copy_storage_path;
  const isSigned = ["Signed", "Completed", "Verified"].includes(a.status as string);
  const isVerified = a.status === "Verified" || a.verification_status === "Manually Verified";
  return (
    <li className={`rounded-lg border border-border bg-secondary/30 p-3 space-y-2 ${compact ? "" : ""}`}>
      <div className="flex items-start gap-2 flex-wrap">
        <FileText className="mt-0.5 h-4 w-4 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {a.clients ? (
              <Link
                to="/admin/clients/$id"
                params={{ id: a.clients.id }}
                search={{ tab: "agreements" }}
                className="font-semibold text-sm hover:text-primary truncate"
              >
                {a.clients.full_name ?? "Client"}
              </Link>
            ) : (
              <span className="font-semibold text-sm">Unknown client</span>
            )}
            <span className="text-[11px] text-muted-foreground truncate">{a.clients?.email}</span>
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {a.template_name}{a.agreement_type ? ` · ${a.agreement_type}` : ""}
            {a.offer_name ? ` · ${a.offer_name}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <AgreementStatusBadge status={a.status} />
          <Badge variant="secondary" className={`border-0 ${VERIFICATION_BADGE[a.verification_status] ?? "bg-muted text-muted-foreground"}`}>
            {a.verification_status}
          </Badge>
          {a.signer_mismatch && (
            <Badge variant="outline" className="border-amber-500/40 text-amber-500 text-[10px]">Signer mismatch</Badge>
          )}
          {isSigned && !hasSignedCopy && (
            <Badge variant="outline" className="border-amber-500/40 text-amber-500 text-[10px]">Signed copy missing</Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-[11px] text-muted-foreground">
        <div>Sent: {a.sent_at ? new Date(a.sent_at).toLocaleString() : "—"}</div>
        <div>Signed: {a.signed_at ? new Date(a.signed_at).toLocaleString() : "—"}</div>
        <div>Method: {a.signing_method ?? "—"}</div>
        <div className="truncate">Doc ID: {a.signnow_document_id ? a.signnow_document_id.slice(0, 12) + "…" : "—"}</div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {a.clients && (
          <Link to="/admin/clients/$id" params={{ id: a.clients.id }} search={{ tab: "agreements" }}>
            <Button size="sm" variant="ghost"><User className="h-3 w-3 mr-1" />Open client</Button>
          </Link>
        )}
        {!isTerminal && (
          <Button size="sm" onClick={onConfirm}>
            <BadgeCheck className="h-3 w-3 mr-1" />Confirm Signed
          </Button>
        )}
        {a.signnow_signing_link && (
          <>
            <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(a.signnow_signing_link!); toast.success("Signing link copied"); }}>
              <Copy className="h-3 w-3 mr-1" />Copy link
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <a href={a.signnow_signing_link} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3 mr-1" />Open link</a>
            </Button>
          </>
        )}
        {a.signnow_completed_link && (
          <Button size="sm" variant="ghost" asChild>
            <a href={a.signnow_completed_link} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3 mr-1" />Open in SignNow</a>
          </Button>
        )}
        {a.signed_copy_url && (
          <Button size="sm" variant="ghost" asChild>
            <a href={a.signed_copy_url} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3 mr-1" />View signed copy</a>
          </Button>
        )}
        {a.signed_copy_storage_path && (
          <Button size="sm" variant="ghost" onClick={onDownload}><Download className="h-3 w-3 mr-1" />Download signed</Button>
        )}
        <Button size="sm" variant="ghost" onClick={onUpload}><Upload className="h-3 w-3 mr-1" />Upload signed copy</Button>
        {isVerified ? (
          <Button size="sm" variant="ghost" className="text-amber-600 dark:text-amber-400" onClick={() => onToggleVerification(false)}>
            <ShieldCheck className="h-3 w-3 mr-1" />Remove verification
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => onToggleVerification(true)}>
            <ShieldCheck className="h-3 w-3 mr-1" />Mark verified
          </Button>
        )}
        {!["Signed", "Completed", "Verified", "Cancelled"].includes(a.status as string) && (
          <>
            <Button size="sm" variant="ghost" onClick={onRemind}><BellRing className="h-3 w-3 mr-1" />Reminder</Button>
            <Button size="sm" variant="ghost" onClick={onResend}><Send className="h-3 w-3 mr-1" />Needs resend</Button>
          </>
        )}
        {a.signnow_document_id && (
          <Button size="sm" variant="ghost" onClick={onRefresh}><RefreshCcw className="h-3 w-3 mr-1" />Refresh status</Button>
        )}
        <Button size="sm" variant="ghost" onClick={onAddNote}><StickyNote className="h-3 w-3 mr-1" />Note</Button>
      </div>

      {a.admin_notes && (
        <div className="rounded-md border border-border bg-background/40 p-2 text-[11px] text-muted-foreground flex items-start gap-2">
          <StickyNote className="h-3 w-3 mt-0.5 shrink-0" />
          <div className="whitespace-pre-wrap">{a.admin_notes}</div>
        </div>
      )}
    </li>
  );
}

/** Quick "Confirm Signed" / "Confirm Signed + Verified" dialog. */
function ConfirmSignedDialog({
  open, agreement, onOpenChange, onDone,
}: {
  open: boolean; agreement: Row | null;
  onOpenChange: (o: boolean) => void; onDone: () => void;
}) {
  const markSignedFn = useServerFn(markAgreementSigned);
  const approveFn = useServerFn(approveSignedAgreement);

  const defaultDate = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [signedDate, setSignedDate] = useState(defaultDate());
  const [signedLink, setSignedLink] = useState("");
  const [signerName, setSignerName] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset when opening
  useMemo(() => {
    if (open && agreement) {
      setSignedDate(defaultDate());
      setSignedLink(agreement.signed_copy_url ?? "");
      setSignerName(agreement.signer_name_in_signnow ?? agreement.clients?.full_name ?? "");
      setNote("");
      setFile(null);
    }
  }, [open, agreement?.id]);

  async function uploadIfAny(): Promise<{ url: string | null; path: string | null }> {
    if (!file || !agreement) return { url: signedLink.trim() || null, path: null };
    const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `signed/${agreement.client_id}/${Date.now()}_${cleanName}`;
    const up = await supabase.storage.from("agreements").upload(path, file, {
      contentType: file.type || "application/pdf", upsert: false,
    });
    if (up.error) throw up.error;
    const { data: signed } = await supabase.storage.from("agreements")
      .createSignedUrl(path, 60 * 60 * 24 * 365);
    return { url: signed?.signedUrl ?? signedLink.trim() ?? null, path };
  }

  async function go(verify: boolean) {
    if (!agreement) return;
    setBusy(true);
    try {
      const { url, path } = await uploadIfAny();
      const signedAtIso = signedDate ? new Date(signedDate).toISOString() : new Date().toISOString();
      if (verify) {
        await approveFn({
          data: {
            id: agreement.id,
            signed_at: signedAtIso,
            signed_copy_url: url,
            signed_copy_storage_path: path,
            verification_note: note.trim() || null,
          } as any,
        });
        toast.success("Confirmed signed & verified");
      } else {
        await markSignedFn({
          data: {
            id: agreement.id,
            signed_at: signedAtIso,
            signed_copy_url: url,
            signed_copy_storage_path: path,
            signer_name_in_signnow: signerName.trim() || null,
          } as any,
        });
        toast.success("Marked as signed");
      }
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Confirm signed agreement</DialogTitle>
          {agreement && (
            <p className="text-xs text-muted-foreground pt-1">
              {agreement.clients?.full_name} · {agreement.template_name}
            </p>
          )}
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <Label className="text-xs">Signed date / time</Label>
            <Input type="datetime-local" value={signedDate} onChange={(e) => setSignedDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Signed copy link (optional)</Label>
            <Input value={signedLink} onChange={(e) => setSignedLink(e.target.value)} placeholder="https://..." />
          </div>
          <div>
            <Label className="text-xs">Upload signed copy (optional)</Label>
            <Input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div>
            <Label className="text-xs">Signer name in SignNow (optional)</Label>
            <Input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="As shown in SignNow" />
          </div>
          <div>
            <Label className="text-xs">Verification note (optional)</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Received signed PDF via email." />
          </div>
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button variant="secondary" onClick={() => go(false)} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}<CheckCircle2 className="h-4 w-4 mr-1" />Confirm Signed
          </Button>
          <Button onClick={() => go(true)} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}<BadgeCheck className="h-4 w-4 mr-1" />Confirm Signed + Verified
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UploadSignedCopyDialog({
  open, agreement, onOpenChange, onDone,
}: {
  open: boolean; agreement: Row | null;
  onOpenChange: (o: boolean) => void; onDone: () => void;
}) {
  const markSignedFn = useServerFn(markAgreementSigned);
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);

  useMemo(() => {
    if (open && agreement) {
      setFile(null);
      setLink(agreement.signed_copy_url ?? "");
    }
  }, [open, agreement?.id]);

  async function go() {
    if (!agreement) return;
    setBusy(true);
    try {
      let url: string | null = link.trim() || null;
      let path: string | null = null;
      if (file) {
        const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        path = `signed/${agreement.client_id}/${Date.now()}_${cleanName}`;
        const up = await supabase.storage.from("agreements").upload(path, file, {
          contentType: file.type || "application/pdf", upsert: false,
        });
        if (up.error) throw up.error;
        const { data: signed } = await supabase.storage.from("agreements")
          .createSignedUrl(path, 60 * 60 * 24 * 365);
        url = signed?.signedUrl ?? url;
      }
      if (!url && !path) {
        toast.error("Pick a file or paste a link");
        return;
      }
      await markSignedFn({
        data: {
          id: agreement.id,
          signed_copy_url: url,
          signed_copy_storage_path: path,
        } as any,
      });
      toast.success("Signed copy attached");
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Attach signed copy</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <Label className="text-xs">Upload signed copy</Label>
            <Input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div>
            <Label className="text-xs">Or paste link</Label>
            <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={go} disabled={busy}>{busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddNoteDialog({
  open, agreement, onOpenChange, onDone,
}: {
  open: boolean; agreement: Row | null;
  onOpenChange: (o: boolean) => void; onDone: () => void;
}) {
  const updateFn = useServerFn(updateAgreement);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useMemo(() => {
    if (open && agreement) setNote(agreement.admin_notes ?? "");
  }, [open, agreement?.id]);

  async function go() {
    if (!agreement) return;
    setBusy(true);
    try {
      await updateFn({ data: { id: agreement.id, admin_notes: note } as any });
      toast.success("Note saved");
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Admin note</DialogTitle></DialogHeader>
        <Textarea rows={5} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal note about this agreement" />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={go} disabled={busy}>{busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Save note</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}