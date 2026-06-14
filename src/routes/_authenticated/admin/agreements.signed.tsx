import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Download, ExternalLink, RefreshCw, FileText, Loader2, Search, User, Mail, DownloadCloud, Trash2, Pencil, Link as LinkIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { getSignedAgreementUrl, refreshAllPendingAgreements, refreshAgreementStatus, importSignNowSignedDocuments, bulkDeleteAgreements, setAgreementCustomTitle, linkAgreementToClient } from "@/lib/agreements.functions";
import { AgreementStatusBadge } from "@/components/agreement-status-badge";
import { VERIFICATION_BADGE } from "@/lib/agreements";

export const Route = createFileRoute("/_authenticated/admin/agreements/signed")({
  component: SignedAgreementsPage,
});

type Row = {
  id: string;
  client_id: string | null;
  template_name: string | null;
  custom_title: string | null;
  agreement_type: string | null;
  status: string;
  verification_status: string;
  signer_mismatch: boolean;
  signed_at: string | null;
  completed_at: string | null;
  updated_at: string | null;
  signing_method: string | null;
  signed_in_person: boolean | null;
  signed_copy_storage_path: string | null;
  signed_copy_url: string | null;
  signnow_completed_link: string | null;
  signnow_document_id: string | null;
  client_full_name: string | null;
  client_email: string | null;
  signer_email: string | null;
  signer_name: string | null;
  clients: { id: string; full_name: string; email: string | null } | null;
};

type ImportSummary = {
  ok: boolean;
  reason?: string | null;
  scanned: number;
  imported: number;
  skipped: number;
  unmatched: number;
  errors: number;
  completedAt: string;
};

function emptyImportSummary(ok: boolean, reason?: string | null): ImportSummary {
  return {
    ok,
    reason: reason ?? null,
    scanned: 0,
    imported: 0,
    skipped: 0,
    unmatched: 0,
    errors: 0,
    completedAt: new Date().toISOString(),
  };
}

function sourceOf(r: Row): "Storage" | "External" | "SignNow link" | "None" {
  if (r.signed_copy_storage_path) return "Storage";
  if (r.signed_copy_url) return "External";
  if (r.signnow_completed_link) return "SignNow link";
  return "None";
}

function methodOf(r: Row): string {
  if (r.signed_in_person) return "In person";
  return r.signing_method ?? (r.signnow_document_id ? "Remote Invite" : "—");
}

function SignedAgreementsPage() {
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [verif, setVerif] = useState<string>("all");
  const [src, setSrc] = useState<string>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [importResult, setImportResult] = useState<ImportSummary | null>(null);
  const [importConfirmOpen, setImportConfirmOpen] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [rowRefreshing, setRowRefreshing] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const getUrlFn = useServerFn(getSignedAgreementUrl);
  const refreshAllFn = useServerFn(refreshAllPendingAgreements);
  const refreshOneFn = useServerFn(refreshAgreementStatus);
  const importFn = useServerFn(importSignNowSignedDocuments);
  const bulkDeleteFn = useServerFn(bulkDeleteAgreements);
  const setTitleFn = useServerFn(setAgreementCustomTitle);
  const linkFn = useServerFn(linkAgreementToClient);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [linkSearch, setLinkSearch] = useState("");

  const { data: clientChoices = [] } = useQuery({
    queryKey: ["link-client-search", linkSearch],
    enabled: linkingId !== null,
    queryFn: async () => {
      let q = supabase.from("clients").select("id, full_name, email").eq("archived", false).order("full_name").limit(20);
      const s = linkSearch.trim();
      if (s) q = q.or(`full_name.ilike.%${s}%,email.ilike.%${s}%`);
      return (await q).data ?? [];
    },
  });

  async function saveCustomTitle(id: string) {
    const v = titleDraft.trim();
    try {
      await setTitleFn({ data: { id, custom_title: v || null } });
      toast.success(v ? "Custom title saved" : "Custom title cleared");
      setEditingTitleId(null);
      setTitleDraft("");
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save title");
    }
  }

  async function linkToClient(id: string, clientId: string) {
    try {
      await linkFn({ data: { id, client_id: clientId } });
      toast.success("Document linked to client");
      setLinkingId(null);
      setLinkSearch("");
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Link failed");
    }
  }

  const importMutation = useMutation({
    mutationFn: async (): Promise<ImportSummary> => {
      const res: any = await importFn({ data: { maxPages: 1 } });
      return {
        ok: res?.ok === true,
        reason: res?.reason ?? null,
        scanned: Number(res?.scanned ?? 0),
        imported: Number(res?.imported ?? 0),
        skipped: Number(res?.skipped ?? 0),
        unmatched: Number(res?.unmatched ?? 0),
        errors: Number(res?.errors ?? 0),
        completedAt: new Date().toISOString(),
      };
    },
    onMutate: () => {
      setImportResult(null);
    },
    onSuccess: (res) => {
      setImportResult(res);
      if (!res.ok) {
        toast.error(res.reason ?? "Import failed");
        return;
      }
      toast.success(
        `Scanned ${res.scanned} · Imported ${res.imported} · Skipped ${res.skipped} · Unmatched ${res.unmatched} · Errors ${res.errors}`,
      );
      refetch();
    },
    onError: (e: any) => {
      const message = e?.message ?? "Import failed";
      setImportResult(emptyImportSummary(false, message));
      toast.error(message);
    },
  });

  const { data: rows = [], refetch, isLoading } = useQuery({
    queryKey: ["admin-signed-agreements"],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("agreements")
        .select("id, client_id, template_name, custom_title, agreement_type, status, verification_status, signer_mismatch, signed_at, completed_at, updated_at, signing_method, signed_in_person, signed_copy_storage_path, signed_copy_url, signnow_completed_link, signnow_document_id, client_full_name, client_email, signer_email, signer_name, clients(id, full_name, email)")
        .or("status.in.(Signed,Completed,Verified),signed_copy_storage_path.not.is.null,signed_at.not.is.null")
        .order("signed_at", { ascending: false, nullsFirst: false })
        .order("updated_at", { ascending: false })
        .limit(1000);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Row[];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromTs = from ? new Date(from).getTime() : null;
    const toTs = to ? new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1 : null;
    return rows.filter((r) => {
      const name = (r.clients?.full_name ?? r.client_full_name ?? "").toLowerCase();
      const email = (r.clients?.email ?? r.client_email ?? "").toLowerCase();
      const tpl = (r.template_name ?? "").toLowerCase();
      if (q && !name.includes(q) && !tpl.includes(q) && !email.includes(q)) return false;
      if (verif !== "all" && r.verification_status !== verif) return false;
      if (src !== "all" && sourceOf(r) !== src) return false;
      const signedDate = r.signed_at ?? r.completed_at;
      if (fromTs || toTs) {
        if (!signedDate) return false;
        const t = new Date(signedDate).getTime();
        if (fromTs && t < fromTs) return false;
        if (toTs && t > toTs) return false;
      }
      return true;
    });
  }, [rows, search, from, to, verif, src]);

  const grouped = useMemo(() => {
    const map = new Map<string, { clientId: string | null; clientName: string; items: Row[] }>();
    for (const r of filtered) {
      const cid = r.client_id ?? "__unlinked__";
      const name = r.client_id
        ? (r.clients?.full_name ?? r.client_full_name ?? "Unknown client")
        : "Unlinked (no client match)";
      const entry = map.get(cid) ?? { clientId: r.client_id, clientName: name, items: [] as Row[] };
      entry.items.push(r);
      map.set(cid, entry);
    }
    const arr = Array.from(map.values());
    arr.sort((a, b) => {
      // Unlinked group goes last
      if (a.clientId === null && b.clientId !== null) return 1;
      if (b.clientId === null && a.clientId !== null) return -1;
      return a.clientName.localeCompare(b.clientName);
    });
    for (const g of arr) {
      g.items.sort((a, b) => {
        const ta = a.signed_at ?? a.completed_at ?? "";
        const tb = b.signed_at ?? b.completed_at ?? "";
        return tb.localeCompare(ta);
      });
    }
    return arr;
  }, [filtered]);

  async function handleDownload(id: string) {
    setDownloading(id);
    try {
      const res = await getUrlFn({ data: { id } });
      if (!res?.url) {
        toast.error("No signed copy available yet for this agreement.");
        return;
      }
      window.open(res.url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not generate download link");
    } finally {
      setDownloading(null);
    }
  }

  async function handleRefreshRow(id: string) {
    setRowRefreshing(id);
    try {
      const res: any = await refreshOneFn({ data: { id } });
      if (res?.ok === false && res?.reason) {
        toast.error(res.reason);
      } else if (res?.storagePath) {
        toast.success("Signed copy pulled from SignNow.");
      } else {
        toast.success("Refreshed from SignNow.");
      }
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Refresh failed");
    } finally {
      setRowRefreshing(null);
    }
  }

  async function handleRefreshAll() {
    setRefreshing(true);
    try {
      const res = await refreshAllFn();
      if (!res.ok) {
        toast.error(res.reason ?? "Refresh failed");
      } else {
        toast.success(
          `Scanned ${res.scanned} pending agreement${res.scanned === 1 ? "" : "s"} · ${res.signedNow} newly signed · ${res.errors} error${res.errors === 1 ? "" : "s"}`,
        );
        refetch();
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  function handleImportHistorical(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (importMutation.isPending) return;
    importMutation.mutate();
  }

  function confirmImportHistorical(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    setImportConfirmOpen(false);
    importMutation.mutate();
  }

  const filteredIds = useMemo(() => filtered.map((r) => r.id), [filtered]);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));
  const someFilteredSelected = filteredIds.some((id) => selected.has(id));

  function toggleOne(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  function toggleGroup(ids: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }
  function toggleAllFiltered(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of filteredIds) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
  }

  async function handleBulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setDeleting(true);
    try {
      const res: any = await bulkDeleteFn({ data: { ids } });
      toast.success(`Deleted ${res?.count ?? ids.length} document${(res?.count ?? ids.length) === 1 ? "" : "s"}`);
      clearSelection();
      setDeleteOpen(false);
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Bulk delete failed");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Signed Documents"
        subtitle="Every signed SignNow document, organized by client and signed date."
      />
      <div className="p-6 md:p-8 space-y-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Search client, email, or template</label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="e.g. Jared, @gmail.com, Liability waiver…"
                className="pl-8"
              />
            </div>
          </div>
          <div className="min-w-[160px]">
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Verification</label>
            <Select value={verif} onValueChange={setVerif}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="Manually Verified">Manually Verified</SelectItem>
                <SelectItem value="Auto-Matched">Auto-Matched</SelectItem>
                <SelectItem value="Not Verified">Not Verified</SelectItem>
                <SelectItem value="Signer Name Mismatch">Signer Name Mismatch</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[140px]">
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Source</label>
            <Select value={src} onValueChange={setSrc}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="Storage">Storage (PDF)</SelectItem>
                <SelectItem value="External">External URL</SelectItem>
                <SelectItem value="SignNow link">SignNow link</SelectItem>
                <SelectItem value="None">No file yet</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Signed from</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Signed to</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button type="button" variant="outline" onClick={handleRefreshAll} disabled={refreshing}>
            {refreshing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Refresh pending
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleImportHistorical}
            disabled={importMutation.isPending}
          >
            {importMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Sync from SignNow
          </Button>
          <div className="text-xs text-muted-foreground bg-secondary/40 rounded-md px-3 py-2 max-w-[320px]">
            Sync refreshes existing agreements from SignNow. It never creates new rows — docs without a linked agreement are reported as unlinked.
          </div>
          <Link to="/admin/agreements" className="text-sm text-primary hover:underline">
            ← Back to Agreements
          </Link>
        </div>

        {importResult && (
          <Card className="border-border bg-secondary/30 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">
                  SignNow import {importResult.ok ? "completed" : "failed"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(importResult.completedAt).toLocaleString()}
                  {importResult.reason ? ` · ${importResult.reason}` : ""}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                <Badge variant="secondary">Scanned {importResult.scanned}</Badge>
                <Badge variant="secondary">Imported {importResult.imported}</Badge>
                <Badge variant="secondary">Skipped {importResult.skipped}</Badge>
                <Badge variant="secondary">Unmatched {importResult.unmatched}</Badge>
                <Badge variant={importResult.errors ? "destructive" : "secondary"}>Errors {importResult.errors}</Badge>
              </div>
            </div>
          </Card>
        )}

        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-3 border-b border-border">
            <div className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={allFilteredSelected ? true : someFilteredSelected ? "indeterminate" : false}
                onCheckedChange={(v) => toggleAllFiltered(v === true)}
                aria-label="Select all filtered documents"
              />
              <span className="text-muted-foreground">
                {selected.size > 0
                  ? `${selected.size} selected`
                  : `Select all (${filteredIds.length})`}
              </span>
              {selected.size > 0 && (
                <Button size="sm" variant="ghost" onClick={clearSelection}>Clear</Button>
              )}
            </div>
            <Button
              size="sm"
              variant="destructive"
              disabled={selected.size === 0}
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete selected
            </Button>
          </div>
          {isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 inline animate-spin mr-2" /> Loading signed documents…
            </div>
          ) : grouped.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <FileText className="h-6 w-6 mx-auto mb-2 opacity-50" />
              No signed documents match your filters yet.
            </div>
          ) : (
            <div className="space-y-6">
              {grouped.map((g) => (
                <div key={g.clientId ?? "unlinked"}>
                  <div className="flex items-center justify-between border-b border-border pb-2 mb-2">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={(() => {
                          const ids = g.items.map((i) => i.id);
                          const all = ids.every((id) => selected.has(id));
                          const some = ids.some((id) => selected.has(id));
                          return all ? true : some ? "indeterminate" : false;
                        })()}
                        onCheckedChange={(v) => toggleGroup(g.items.map((i) => i.id), v === true)}
                        aria-label={`Select all documents for ${g.clientName}`}
                      />
                      {g.clientId ? (
                        <Link
                          to="/admin/clients/$id"
                          params={{ id: g.clientId }}
                          className="flex items-center gap-2 font-semibold hover:underline"
                        >
                          <User className="h-4 w-4 text-muted-foreground" />
                          {g.clientName}
                        </Link>
                      ) : (
                        <span className="flex items-center gap-2 font-semibold text-amber-500">
                          <LinkIcon className="h-4 w-4" />
                          {g.clientName}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {g.items.length} document{g.items.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <ul className="divide-y divide-border">
                    {g.items.map((a) => {
                      const signedDate = a.signed_at ?? a.completed_at;
                      const hasFile = !!a.signed_copy_storage_path || !!a.signed_copy_url;
                      const email = a.clients?.email ?? a.client_email ?? a.signer_email ?? null;
                      const displayTitle = a.custom_title ?? a.template_name ?? a.agreement_type ?? "Agreement";
                      const isEditingTitle = editingTitleId === a.id;
                      return (
                        <li key={a.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                          <Checkbox
                            checked={selected.has(a.id)}
                            onCheckedChange={(v) => toggleOne(a.id, v === true)}
                            aria-label="Select document"
                          />
                          <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            {isEditingTitle ? (
                              <div className="flex items-center gap-1">
                                <Input
                                  autoFocus
                                  value={titleDraft}
                                  onChange={(e) => setTitleDraft(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") saveCustomTitle(a.id);
                                    if (e.key === "Escape") { setEditingTitleId(null); setTitleDraft(""); }
                                  }}
                                  placeholder={a.template_name ?? "Custom title"}
                                  className="h-7 text-sm"
                                />
                                <Button size="sm" variant="default" className="h-7" onClick={() => saveCustomTitle(a.id)}>Save</Button>
                                <Button size="sm" variant="ghost" className="h-7" onClick={() => { setEditingTitleId(null); setTitleDraft(""); }}>Cancel</Button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium truncate">{displayTitle}</span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-1.5"
                                  onClick={() => { setEditingTitleId(a.id); setTitleDraft(a.custom_title ?? ""); }}
                                  title="Set custom title"
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                {a.custom_title && (
                                  <span className="text-[10px] text-muted-foreground truncate">
                                    (orig: {a.template_name ?? "Untitled"})
                                  </span>
                                )}
                              </div>
                            )}
                            <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5">
                              <span className="font-medium text-foreground/80">
                                {signedDate
                                  ? `Signed ${new Date(signedDate).toLocaleString()}`
                                  : "Signed date unknown"}
                              </span>
                              {email && (
                                <span className="inline-flex items-center gap-1">
                                  <Mail className="h-3 w-3" /> {email}
                                </span>
                              )}
                              {a.signer_name && !a.client_id && (
                                <span>· Signer: {a.signer_name}</span>
                              )}
                              <span>· {methodOf(a)}</span>
                              <span>· {sourceOf(a)}</span>
                            </div>
                          </div>
                          <AgreementStatusBadge status={a.status} />
                          <Badge
                            variant="secondary"
                            className={`border-0 ${VERIFICATION_BADGE[a.verification_status] ?? ""}`}
                          >
                            {a.verification_status}
                          </Badge>
                          <div className="flex items-center gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!hasFile || downloading === a.id}
                              onClick={() => handleDownload(a.id)}
                              title={hasFile ? "View / download signed PDF" : "Signed copy not yet pulled"}
                            >
                              {downloading === a.id ? (
                                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                              ) : (
                                <Download className="h-3.5 w-3.5 mr-1" />
                              )}
                              View
                            </Button>
                            {a.signnow_document_id && (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={rowRefreshing === a.id}
                                onClick={() => handleRefreshRow(a.id)}
                                title="Refresh status and pull signed copy from SignNow"
                              >
                                {rowRefreshing === a.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <RefreshCw className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            )}
                            {a.signnow_completed_link && (
                              <a
                                href={a.signnow_completed_link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                              >
                                <ExternalLink className="h-3 w-3" /> SignNow
                              </a>
                            )}
                            {a.client_id ? (
                              <Link
                                to="/admin/clients/$id"
                                params={{ id: a.client_id }}
                                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                              >
                                <User className="h-3 w-3" /> Client
                              </Link>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => { setLinkingId(a.id); setLinkSearch(a.signer_email ?? ""); }}
                                title="Link this document to a client"
                              >
                                <LinkIcon className="h-3 w-3 mr-1" /> Link to client
                              </Button>
                            )}
                          </div>
                          {linkingId === a.id && (
                            <div className="w-full mt-2 rounded-md border border-border bg-secondary/30 p-3 space-y-2">
                              <div className="flex items-center gap-2">
                                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                                <Input
                                  autoFocus
                                  value={linkSearch}
                                  onChange={(e) => setLinkSearch(e.target.value)}
                                  placeholder="Search client by name or email…"
                                  className="h-8 text-sm"
                                />
                                <Button size="sm" variant="ghost" onClick={() => { setLinkingId(null); setLinkSearch(""); }}>Cancel</Button>
                              </div>
                              <ul className="max-h-48 overflow-auto divide-y divide-border text-sm">
                                {clientChoices.length === 0 ? (
                                  <li className="py-2 text-xs text-muted-foreground">No matching clients</li>
                                ) : clientChoices.map((c: any) => (
                                  <li key={c.id} className="flex items-center justify-between py-1.5">
                                    <span className="truncate"><span className="font-medium">{c.full_name}</span> <span className="text-muted-foreground text-xs">{c.email ?? ""}</span></span>
                                    <Button size="sm" variant="outline" onClick={() => linkToClient(a.id, c.id)}>Link</Button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      <AlertDialog open={deleteOpen} onOpenChange={(o) => !deleting && setDeleteOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} signed document{selected.size === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected agreement records and any signed PDF files stored for them.
              Audit entries are written before deletion. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleBulkDelete(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}