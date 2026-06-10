import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ExternalLink, Copy, ShieldCheck, AlertTriangle, FileText, Send, BellRing, Upload, Trash2, Loader2,
  UserPlus, RefreshCcw, Download, CheckCircle2, Flag, StickyNote, BadgeCheck, RotateCcw, MoreHorizontal,
  Archive, ArchiveRestore, Search,
} from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { AgreementStatusBadge } from "@/components/agreement-status-badge";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { DoubleConfirmDeleteDialog } from "@/components/double-confirm-delete-dialog";
import { useBulkSelection } from "@/hooks/use-bulk-selection";
import { fileLabel, AGREEMENT_TYPES, VERIFICATION_BADGE, type Agreement, type AgreementTemplate, type SigningMethod } from "@/lib/agreements";
import {
  createAgreement, updateAgreement, markAgreementSigned, verifyAgreement,
  sendAgreementReminder, cancelAgreement, refreshAgreementStatus, getSignedAgreementUrl,
  approveSignedAgreement, setAgreementVerification, reopenAgreement,
  archiveAgreement, unarchiveAgreement, deleteAgreement,
  bulkArchiveAgreements, bulkDeleteAgreements, bulkUpdateAgreementStatus, bulkVerifyAgreements,
} from "@/lib/agreements.functions";

type AgreementBucket = "active" | "completed" | "terminal" | "archived";

function bucketFor(a: Agreement): AgreementBucket {
  if (a.archived) return "archived";
  const status = a.status as string;
  if (["Verified", "Completed", "Signed"].includes(status)) return "completed";
  if (["Cancelled", "Declined", "Expired", "Error"].includes(status)) return "terminal";
  return "active";
}

const FILTERS = [
  { value: "all", label: "All active" },
  { value: "active", label: "Waiting on Client" },
  { value: "needs-verification", label: "Needs Verification" },
  { value: "completed", label: "Signed / Verified" },
  { value: "terminal", label: "Cancelled / Error" },
  { value: "archived", label: "Archived" },
] as const;

export function AgreementsPanel({ clientId, clientName }: { clientId: string; clientName?: string }) {
  const qc = useQueryClient();
  const [sendMode, setSendMode] = useState<null | "invite">(null);
  const [openUpload, setOpenUpload] = useState<Agreement | null>(null);
  const [openVerify, setOpenVerify] = useState<Agreement | null>(null);
  const [openApprove, setOpenApprove] = useState<Agreement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Agreement | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const createFn = useServerFn(createAgreement);
  const updateFn = useServerFn(updateAgreement);
  const markSignedFn = useServerFn(markAgreementSigned);
  const verifyFn = useServerFn(verifyAgreement);
  const approveFn = useServerFn(approveSignedAgreement);
  const reminderFn = useServerFn(sendAgreementReminder);
  const cancelFn = useServerFn(cancelAgreement);
  const refreshFn = useServerFn(refreshAgreementStatus);
  const getSignedUrlFn = useServerFn(getSignedAgreementUrl);
  const setVerificationFn = useServerFn(setAgreementVerification);
  const reopenFn = useServerFn(reopenAgreement);
  const archiveFn = useServerFn(archiveAgreement);
  const unarchiveFn = useServerFn(unarchiveAgreement);
  const deleteFn = useServerFn(deleteAgreement);
  const bulkArchiveFn = useServerFn(bulkArchiveAgreements);
  const bulkDeleteFn = useServerFn(bulkDeleteAgreements);
  const bulkStatusFn = useServerFn(bulkUpdateAgreementStatus);
  const bulkVerifyFn = useServerFn(bulkVerifyAgreements);

  const { data: agreements = [] } = useQuery({
    queryKey: ["client-agreements", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("agreements")
        .select("*").eq("client_id", clientId).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Agreement[];
    },
  });

  const summary = useMemo(() => {
    const live = agreements.filter((a) => !a.archived);
    const sorted = [...live].sort((a, b) => {
      const ta = (a.signed_at ?? a.completed_at ?? a.sent_at ?? a.created_at ?? "") as string;
      const tb = (b.signed_at ?? b.completed_at ?? b.sent_at ?? b.created_at ?? "") as string;
      return tb.localeCompare(ta);
    });
    const latestSigned = sorted.find((a) => bucketFor(a) === "completed") ?? null;
    const latest = sorted[0] ?? null;
    const hasSignedCopy = !!(latestSigned?.signed_copy_url || latestSigned?.signed_copy_storage_path);
    return {
      total: agreements.length,
      active: agreements.filter((a) => bucketFor(a) === "active").length,
      completed: agreements.filter((a) => bucketFor(a) === "completed").length,
      archived: agreements.filter((a) => a.archived).length,
      latestSigned, latest, hasSignedCopy,
    };
  }, [agreements]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return agreements.filter((a) => {
      const b = bucketFor(a);
      if (filter === "archived") {
        if (!a.archived) return false;
      } else if (filter === "all") {
        if (a.archived) return false;
      } else if (filter === "active") {
        if (a.archived || b !== "active") return false;
      } else if (filter === "completed") {
        if (a.archived || b !== "completed") return false;
      } else if (filter === "terminal") {
        if (a.archived || b !== "terminal") return false;
      } else if (filter === "needs-verification") {
        if (a.archived) return false;
        const needs = a.status === "Needs Manual Verification" ||
          a.verification_status === "Needs Review" || a.signer_mismatch ||
          (a.status === "Signed" && a.verification_status === "Not Verified");
        if (!needs) return false;
      }
      if (q) {
        const hay = `${a.template_name ?? ""} ${a.agreement_type ?? ""} ${a.offer_name ?? ""} ${a.status ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      const ta = (a.signed_at ?? a.completed_at ?? a.sent_at ?? a.updated_at ?? a.created_at ?? "") as string;
      const tb = (b.signed_at ?? b.completed_at ?? b.sent_at ?? b.updated_at ?? b.created_at ?? "") as string;
      return tb.localeCompare(ta);
    });
  }, [agreements, filter, search]);

  const grouped = useMemo(() => {
    const buckets: Record<AgreementBucket, Agreement[]> = {
      active: [], completed: [], terminal: [], archived: [],
    };
    for (const a of filtered) buckets[bucketFor(a)].push(a);
    return buckets;
  }, [filtered]);

  const sel = useBulkSelection(filtered.map((a) => a.id));

  const { data: templates = [] } = useQuery({
    queryKey: ["agreement-templates-active"],
    queryFn: async () => {
      const { data } = await supabase.from("agreement_templates")
        .select("*").eq("archived", false).eq("is_active", true).order("name");
      return (data ?? []) as AgreementTemplate[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["client-agreements", clientId] });

  const selectedRows = useMemo(
    () => agreements.filter((a) => sel.isSelected(a.id)),
    [agreements, sel],
  );
  const selectedHasSignedCopy = selectedRows.some(
    (a) => a.signed_copy_storage_path || a.signed_copy_url,
  );

  async function handleRowAction(action: string, a: Agreement) {
    try {
      switch (action) {
        case "refresh": {
          const r: any = await refreshFn({ data: { id: a.id } });
          r?.ok ? toast.success(`Refreshed: ${r.status}`) : toast.error(r?.reason ?? "Refresh failed");
          invalidate(); break;
        }
        case "open-signnow":
          if (a.signnow_completed_link) window.open(a.signnow_completed_link, "_blank", "noopener,noreferrer");
          else toast.error("No SignNow link on this record."); break;
        case "upload":
        case "mark-signed": setOpenUpload(a); break;
        case "mark-verified": setOpenVerify(a); break;
        case "approve": setOpenApprove(a); break;
        case "remove-verification": {
          const r: any = await setVerificationFn({ data: { id: a.id, verified: false } });
          toast.success(`Verification removed · ${r?.newStatus ?? "Needs attention"}`);
          invalidate(); break;
        }
        case "reopen":
          await reopenFn({ data: { id: a.id } });
          toast.success("Agreement reopened · client will see it again");
          invalidate(); break;
        case "remind":
          await reminderFn({ data: { id: a.id } });
          toast.success("Reminder logged"); invalidate(); break;
        case "needs-followup":
          await updateFn({ data: { id: a.id, status: "Needs Manual Verification" } as any });
          toast.success("Flagged for follow-up"); invalidate(); break;
        case "cancel":
          await cancelFn({ data: { id: a.id } });
          toast.success("Cancelled"); invalidate(); break;
        case "archive":
          await archiveFn({ data: { id: a.id } });
          toast.success("Archived"); invalidate(); break;
        case "unarchive":
          await unarchiveFn({ data: { id: a.id } });
          toast.success("Restored"); invalidate(); break;
        case "delete": setDeleteTarget(a); break;
        case "download-signed": {
          const r: any = await getSignedUrlFn({ data: { id: a.id } });
          if (r?.url) window.open(r.url, "_blank", "noopener,noreferrer");
          else toast.error("No signed copy available.");
          break;
        }
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Action failed");
    }
  }

  async function bulkAction(kind: "archive" | "delete" | "verify" | "follow-up" | "waiting" | "remind") {
    const ids = sel.selectedIds;
    if (ids.length === 0) return;
    try {
      if (kind === "archive") {
        const r: any = await bulkArchiveFn({ data: { ids } });
        toast.success(`Archived ${r.count}`); sel.clear(); invalidate();
      } else if (kind === "verify") {
        const r: any = await bulkVerifyFn({ data: { ids } });
        toast.success(`Verified ${r.count}`); sel.clear(); invalidate();
      } else if (kind === "follow-up") {
        const r: any = await bulkStatusFn({ data: { ids, status: "Needs Manual Verification" } });
        toast.success(`Flagged ${r.count}`); sel.clear(); invalidate();
      } else if (kind === "waiting") {
        const r: any = await bulkStatusFn({ data: { ids, status: "Waiting on Client" } });
        toast.success(`Marked ${r.count} waiting`); sel.clear(); invalidate();
      } else if (kind === "remind") {
        let n = 0;
        for (const id of ids) {
          try { await reminderFn({ data: { id } }); n += 1; } catch { /* keep going */ }
        }
        toast.success(`Logged ${n} reminder${n === 1 ? "" : "s"}`); sel.clear(); invalidate();
      } else if (kind === "delete") {
        setBulkDeleteOpen(true);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Bulk action failed");
    }
  }

  return (
    <Card className="border-border bg-card p-5 space-y-3 md:col-span-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Agreements (SignNow)</h3>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" onClick={() => setSendMode("invite")}><UserPlus className="h-3.5 w-3.5 mr-1" /> Invite to Sign</Button>
          <Button size="sm" variant="outline" onClick={() => setOpenUpload({} as any)}>
            <Upload className="h-3.5 w-3.5 mr-1" /> Upload signed copy
          </Button>
        </div>
      </div>

      <SummaryCard summary={summary} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input className="pl-7 h-9" placeholder="Search template, offer, status…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="h-9 w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {filtered.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer ml-auto">
            <Checkbox
              checked={sel.allSelected ? true : sel.someSelected ? "indeterminate" : false}
              onCheckedChange={() => sel.toggleAll()}
            />
            Select all visible
          </label>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          {agreements.length === 0
            ? "No agreements yet. Send one through SignNow or upload an existing signed copy."
            : "No agreements match the current filter."}
        </p>
      ) : (
        <div className="space-y-4">
          {(["active", "completed", "terminal", "archived"] as AgreementBucket[]).map((bucket) => {
            const rows = grouped[bucket];
            if (rows.length === 0) return null;
            const label = ({
              active: "Active / Pending",
              completed: "Signed / Verified",
              terminal: "Cancelled / Error",
              archived: "Archived",
            } as const)[bucket];
            return (
              <section key={bucket} className="space-y-2">
                <h4 className="text-[11px] uppercase tracking-widest text-muted-foreground px-1">
                  {label} <span className="opacity-60">({rows.length})</span>
                </h4>
                <ul className="space-y-2">
                  {rows.map((a) => (
                    <AgreementRow
                      key={a.id}
                      ag={a}
                      selected={sel.isSelected(a.id)}
                      onSelect={(c) => sel.setOne(a.id, c)}
                      onAction={(act) => handleRowAction(act, a)}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <BulkActionBar count={sel.count} onClear={sel.clear}>
        <Button size="sm" variant="ghost" onClick={() => bulkAction("verify")}>
          <ShieldCheck className="h-3.5 w-3.5 mr-1" />Verify
        </Button>
        <Button size="sm" variant="ghost" onClick={() => bulkAction("waiting")}>
          <Send className="h-3.5 w-3.5 mr-1" />Waiting on Client
        </Button>
        <Button size="sm" variant="ghost" onClick={() => bulkAction("follow-up")}>
          <Flag className="h-3.5 w-3.5 mr-1" />Follow-up
        </Button>
        <Button size="sm" variant="ghost" onClick={() => bulkAction("remind")}>
          <BellRing className="h-3.5 w-3.5 mr-1" />Reminders
        </Button>
        <Button size="sm" variant="ghost" onClick={() => bulkAction("archive")}>
          <Archive className="h-3.5 w-3.5 mr-1" />Archive
        </Button>
        <Button size="sm" variant="ghost" className="text-red-600 dark:text-red-400" onClick={() => bulkAction("delete")}>
          <Trash2 className="h-3.5 w-3.5 mr-1" />Delete
        </Button>
      </BulkActionBar>

      <DoubleConfirmDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        count={1}
        title="Delete agreement record?"
        message="Are you sure you want to delete this agreement record?"
        strongWarning={
          deleteTarget && (deleteTarget.signed_copy_storage_path || deleteTarget.signed_copy_url)
            ? "This agreement has a signed document attached. Deleting it may remove access to an important client record."
            : undefined
        }
        confirmLabel="Delete Agreement"
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteFn({ data: { id: deleteTarget.id } });
          toast.success("Agreement deleted");
          invalidate();
        }}
      />

      <DoubleConfirmDeleteDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        count={sel.count}
        title={`Delete ${sel.count} agreement records?`}
        message={`You are about to delete ${sel.count} agreement records.`}
        strongWarning={selectedHasSignedCopy ? "One or more selected agreements have signed documents attached." : undefined}
        confirmLabel="Delete Selected Agreements"
        onConfirm={async () => {
          const r: any = await bulkDeleteFn({ data: { ids: sel.selectedIds } });
          toast.success(`Deleted ${r.count}`);
          sel.clear();
          invalidate();
        }}
      />

      <SendAgreementDialog
        open={sendMode !== null}
        onOpenChange={(o) => !o && setSendMode(null)}
        clientName={clientName}
        templates={templates}
        onSubmit={async (payload) => {
          const ag = await createFn({ data: { client_id: clientId, ...payload } as any });
          const apiErr = (ag as any)?._api_error as string | null | undefined;
          const apiSent = (ag as any)?._api_document_id as string | null | undefined;
          if (payload.signing_method === "Remote Invite") {
            if (apiErr) toast.error(`SignNow invite failed — saved as Manual Action Needed. ${apiErr}`);
            else if (apiSent) toast.success("SignNow invite sent. Client will receive an email from SignNow.");
            else toast.success("Invite logged. Open or copy the signing link to send it to the client.");
          } else {
            toast.success("Agreement created");
          }
          invalidate(); setSendMode(null);
        }}
      />

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

      <ApproveSignedDialog
        open={!!openApprove}
        onOpenChange={(o) => !o && setOpenApprove(null)}
        clientId={clientId}
        agreement={openApprove}
        onSubmit={async (payload) => {
          if (!openApprove) return;
          await approveFn({ data: { id: openApprove.id, ...payload } as any });
          toast.success("Agreement approved — client will see it as complete.");
          invalidate(); setOpenApprove(null);
        }}
      />
    </Card>
  );
}

function SummaryCard({ summary }: {
  summary: {
    total: number; active: number; completed: number; archived: number;
    latestSigned: Agreement | null; latest: Agreement | null; hasSignedCopy: boolean;
  };
}) {
  const latest = summary.latestSigned ?? summary.latest;
  const signed = !!summary.latestSigned;
  return (
    <div className="rounded-lg border border-border bg-secondary/20 p-3 grid gap-3 sm:grid-cols-2 md:grid-cols-4">
      <div>
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Latest agreement</p>
        <p className="text-sm font-semibold mt-1 truncate">{latest?.template_name ?? "—"}</p>
        {latest && <div className="mt-1"><AgreementStatusBadge status={latest.status} /></div>}
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Signed?</p>
        <p className={`text-sm font-semibold mt-1 ${signed ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
          {signed ? "Yes" : "No"}
        </p>
        {summary.latestSigned?.signed_at && (
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {new Date(summary.latestSigned.signed_at).toLocaleDateString()}
          </p>
        )}
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Verification</p>
        <div className="mt-1">
          {latest ? (
            <Badge variant="secondary" className={`border-0 ${VERIFICATION_BADGE[latest.verification_status] ?? "bg-muted text-muted-foreground"}`}>
              {latest.verification_status}
            </Badge>
          ) : <span className="text-sm text-muted-foreground">—</span>}
        </div>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Signed copy</p>
        <p className={`text-sm font-semibold mt-1 ${summary.hasSignedCopy ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
          {summary.hasSignedCopy ? "Available" : "Missing"}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {summary.active} active · {summary.completed} signed · {summary.archived} archived
        </p>
      </div>
    </div>
  );
}

function AgreementRow({
  ag, selected, onSelect, onAction,
}: {
  ag: Agreement;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  onAction: (action: string) => void;
}) {
  const label = useMemo(() => fileLabel({
    clientName: ag.client_full_name ?? ag.correct_client_name ?? "Client",
    agreementType: ag.agreement_type ?? ag.template_name,
    signedAt: ag.signed_at ?? ag.completed_at,
    offerName: ag.offer_name,
  }), [ag]);

  const isSignNowApi = !!ag.signnow_document_id;
  const sourceLabel = isSignNowApi ? "SignNow API" : (ag.signing_method ?? "Manual");
  const hasSignedCopy = !!(ag.signed_copy_url || ag.signed_copy_storage_path);
  const isVerified = ag.status === "Verified" || ag.verification_status === "Manually Verified";
  const isSigned = ["Signed", "Completed", "Verified"].includes(ag.status as string);
  const isTerminal = ["Cancelled", "Declined", "Expired", "Error"].includes(ag.status as string);
  const isWaiting = !isSigned && !isTerminal && !ag.archived;

  return (
    <li className={`rounded-lg border p-3 space-y-2 ${ag.archived ? "border-dashed border-border bg-muted/20 opacity-80" : "border-border bg-secondary/30"}`}>
      <div className="flex items-start gap-2">
        <Checkbox checked={selected} onCheckedChange={(c) => onSelect(c === true)} className="mt-1" />
        <FileText className="h-4 w-4 text-muted-foreground mt-1 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{label}</p>
          <p className="text-xs text-muted-foreground truncate">
            {ag.template_name}{ag.agreement_type ? ` · ${ag.agreement_type}` : ""}
            {ag.offer_name ? ` · ${ag.offer_name}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-wrap shrink-0">
          <AgreementStatusBadge status={ag.status} />
          {ag.verification_status && ag.verification_status !== "Not Verified" && (
            <Badge variant="secondary" className={`border-0 ${VERIFICATION_BADGE[ag.verification_status] ?? "bg-muted text-muted-foreground"}`}>
              {ag.verification_status}
            </Badge>
          )}
          <Badge variant="outline" className="border-border text-[10px]">{sourceLabel}</Badge>
          {ag.archived && <Badge variant="outline" className="text-[10px]">Archived</Badge>}
        </div>
      </div>

      {ag.signer_mismatch && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs flex items-start gap-2 ml-8">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            Signer name mismatch. SignNow showed <strong>{ag.signer_name_in_signnow}</strong> but the agreement belongs to <strong>{ag.correct_client_name}</strong>.
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 ml-8">
        {isWaiting && (
          <>
            {ag.signnow_signing_link && (
              <>
                <Button size="sm" variant="outline" asChild>
                  <a href={ag.signnow_signing_link} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3 mr-1" />Open</a>
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(ag.signnow_signing_link!); toast.success("Link copied"); }}>
                  <Copy className="h-3 w-3 mr-1" />Copy link
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onAction("remind")}>
                  <BellRing className="h-3 w-3 mr-1" />Reminder
                </Button>
              </>
            )}
            <Button size="sm" onClick={() => onAction("approve")}>
              <BadgeCheck className="h-3 w-3 mr-1" />Approve Signed
            </Button>
          </>
        )}

        {isSigned && !isVerified && (
          <>
            {hasSignedCopy && ag.signed_copy_url && (
              <Button size="sm" variant="outline" asChild>
                <a href={ag.signed_copy_url} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3 mr-1" />View signed copy</a>
              </Button>
            )}
            {hasSignedCopy && ag.signed_copy_storage_path && !ag.signed_copy_url && (
              <Button size="sm" variant="outline" onClick={() => onAction("download-signed")}>
                <Download className="h-3 w-3 mr-1" />View signed copy
              </Button>
            )}
            <Button size="sm" onClick={() => onAction("mark-verified")}>
              <ShieldCheck className="h-3 w-3 mr-1" />Mark Verified
            </Button>
          </>
        )}

        {isVerified && (
          <>
            {ag.signed_copy_url && (
              <Button size="sm" variant="outline" asChild>
                <a href={ag.signed_copy_url} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3 mr-1" />View signed copy</a>
              </Button>
            )}
            {ag.signed_copy_storage_path && (
              <Button size="sm" variant="outline" onClick={() => onAction("download-signed")}>
                <Download className="h-3 w-3 mr-1" />Download PDF
              </Button>
            )}
          </>
        )}

        {isTerminal && (
          <>
            {ag.signed_copy_url && (
              <Button size="sm" variant="outline" asChild>
                <a href={ag.signed_copy_url} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3 mr-1" />View details</a>
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => onAction("reopen")}>
              <RotateCcw className="h-3 w-3 mr-1" />Reopen
            </Button>
          </>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0"><MoreHorizontal className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest">Status</DropdownMenuLabel>
            {ag.signnow_document_id && (
              <DropdownMenuItem onClick={() => onAction("refresh")}>
                <RefreshCcw className="h-3.5 w-3.5 mr-2" />Refresh status
              </DropdownMenuItem>
            )}
            {ag.signnow_completed_link && (
              <DropdownMenuItem onClick={() => onAction("open-signnow")}>
                <ExternalLink className="h-3.5 w-3.5 mr-2" />Open in SignNow
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => onAction("upload")}>
              <Upload className="h-3.5 w-3.5 mr-2" />Upload signed copy
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest">Verification</DropdownMenuLabel>
            {!isSigned && (
              <DropdownMenuItem onClick={() => onAction("mark-signed")}>
                <CheckCircle2 className="h-3.5 w-3.5 mr-2" />Mark signed
              </DropdownMenuItem>
            )}
            {isSigned && !isTerminal && (
              <DropdownMenuItem onClick={() => onAction("reopen")}>
                <RotateCcw className="h-3.5 w-3.5 mr-2" />Mark unsigned / reopen
              </DropdownMenuItem>
            )}
            {!isVerified && (
              <DropdownMenuItem onClick={() => onAction("mark-verified")}>
                <ShieldCheck className="h-3.5 w-3.5 mr-2" />Mark verified
              </DropdownMenuItem>
            )}
            {isVerified && (
              <DropdownMenuItem onClick={() => onAction("remove-verification")} className="text-amber-600 dark:text-amber-400">
                <ShieldCheck className="h-3.5 w-3.5 mr-2" />Remove verification
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => onAction("needs-followup")}>
              <Flag className="h-3.5 w-3.5 mr-2" />Needs follow-up
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest">Record</DropdownMenuLabel>
            {!isTerminal && (
              <DropdownMenuItem onClick={() => onAction("cancel")}>
                <Trash2 className="h-3.5 w-3.5 mr-2" />Cancel agreement
              </DropdownMenuItem>
            )}
            {ag.archived ? (
              <DropdownMenuItem onClick={() => onAction("unarchive")}>
                <ArchiveRestore className="h-3.5 w-3.5 mr-2" />Restore from archive
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => onAction("archive")}>
                <Archive className="h-3.5 w-3.5 mr-2" />Archive
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => onAction("delete")} className="text-red-600 dark:text-red-400">
              <Trash2 className="h-3.5 w-3.5 mr-2" />Delete permanently
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-muted-foreground pt-1 ml-8">
        <div>Sent: {ag.sent_at ? new Date(ag.sent_at).toLocaleDateString() : "—"}</div>
        <div>Signed: {ag.signed_at ? new Date(ag.signed_at).toLocaleDateString() : "—"}</div>
        <div>Verified: {ag.verified_at ? new Date(ag.verified_at).toLocaleDateString() : "—"}</div>
        <div className="truncate">Offer: {ag.offer_name ?? "—"}</div>
      </div>
      {ag.admin_notes && (
        <div className="rounded-md border border-border bg-background/40 p-2 text-[11px] text-muted-foreground flex items-start gap-2 ml-8">
          <StickyNote className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <div className="whitespace-pre-wrap">{ag.admin_notes}</div>
        </div>
      )}
    </li>
  );
}
function SendAgreementDialog({
  open, onOpenChange, templates, clientName, onSubmit,
}: {
  open: boolean;
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
  const [busy, setBusy] = useState(false);

  const tpl = templates.find((t) => t.id === templateId);
  const signingMethod: SigningMethod = "Remote Invite";

  async function go() {
    const finalLink = link.trim() || tpl?.signnow_url || null;
    if (!templateId && !finalLink) {
      toast.error("Pick a template or paste a SignNow signing link");
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
          <DialogTitle>Invite to Sign — SignNow</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {clientName && (
            <p className="text-xs text-muted-foreground">
              Client: <strong className="text-foreground">{clientName}</strong>
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
              Paste the signing link from your SignNow template. We'll save it on the record so you can copy/send it from the agreement row.
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={go} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Create invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApproveSignedDialog({
  open, onOpenChange, clientId, agreement, onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
  agreement: Agreement | null;
  onSubmit: (payload: {
    signed_at?: string | null;
    signed_copy_url?: string | null;
    signed_copy_storage_path?: string | null;
    verification_note?: string | null;
  }) => Promise<void>;
}) {
  const initialDate = () => {
    const src = agreement?.signed_at ?? agreement?.completed_at ?? new Date().toISOString();
    const d = new Date(src);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [signedDate, setSignedDate] = useState(initialDate());
  const [signedLink, setSignedLink] = useState(agreement?.signed_copy_url ?? "");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    try {
      let signedUrl: string | null = signedLink.trim() || null;
      let signedPath: string | null = null;
      if (file) {
        const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `signed/${clientId}/${Date.now()}_${cleanName}`;
        const up = await supabase.storage.from("agreements").upload(path, file, {
          contentType: file.type || "application/pdf", upsert: false,
        });
        if (up.error) throw up.error;
        signedPath = path;
        const { data: signed } = await supabase.storage.from("agreements")
          .createSignedUrl(path, 60 * 60 * 24 * 365);
        signedUrl = signed?.signedUrl ?? signedUrl;
      }
      await onSubmit({
        signed_at: signedDate ? new Date(signedDate).toISOString() : null,
        signed_copy_url: signedUrl,
        signed_copy_storage_path: signedPath,
        verification_note: note.trim() || null,
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to approve");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Approve signed agreement</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground text-xs">
            Confirm this signed agreement was received. The client will see it as <strong>Completed</strong> and it will be removed from outstanding alerts. All fields below are optional.
          </p>
          <div>
            <Label className="text-xs">Signed date / time</Label>
            <Input type="datetime-local" value={signedDate} onChange={(e) => setSignedDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Signed copy link</Label>
            <Input value={signedLink} onChange={(e) => setSignedLink(e.target.value)} placeholder="https://..." />
          </div>
          <div>
            <Label className="text-xs">Upload signed copy</Label>
            <Input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div>
            <Label className="text-xs">Admin verification note</Label>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Received signed PDF via email on Jun 5." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={go} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Approve / Mark Received
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