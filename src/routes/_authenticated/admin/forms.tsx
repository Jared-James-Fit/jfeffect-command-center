import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import { AdminNativeForms } from "./native-forms";
import { FilloutSubmissionsPage } from "./fillout-submissions";
import { ApplicationsInbox } from "./sales.coaching-applications";
import { AgreementsAdminPage } from "./agreements.index";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Plus, ExternalLink, Copy, MoreHorizontal, Pencil, Archive, Trash2, ArchiveRestore, FileEdit, Users, X } from "lucide-react";
import { toast } from "sonner";
import { listForms, archiveForm, deleteForm, listFormAssignments, assignFormToClient, unassignFormFromClient, type FormLink } from "@/lib/form-links";
import { supabase } from "@/integrations/supabase/client";
import { FormLinkDialog } from "@/components/form-link-dialog";
import { DoubleConfirmDeleteDialog } from "@/components/double-confirm-delete-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ActionButton } from "@/components/action-button";

const TABS = [
  { value: "native-forms", label: "Native Forms" },
  { value: "document-forms", label: "Document Forms" },
  { value: "fillout-submissions", label: "Fillout Submissions" },
  { value: "coaching-applications", label: "Coaching Applications" },
  { value: "agreements", label: "Agreements" },
] as const;
type TabKey = typeof TABS[number]["value"];

const LAST_TAB_KEY = "jf-admin-forms-last-tab";

function isTab(v: unknown): v is TabKey {
  return typeof v === "string" && TABS.some((t) => t.value === v);
}

export const Route = createFileRoute("/_authenticated/admin/forms")({
  validateSearch: (raw: Record<string, unknown>): { tab: TabKey } => {
    const t = raw?.tab;
    if (isTab(t)) return { tab: t };
    // URL takes priority; only consult localStorage when search is missing.
    if (typeof t === "undefined" && typeof window !== "undefined") {
      try {
        const stored = window.localStorage.getItem(LAST_TAB_KEY);
        if (isTab(stored)) return { tab: stored };
      } catch {}
    }
    return { tab: "native-forms" };
  },
  component: FormsWorkspacePage,
});

function FormsWorkspacePage() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();

  // Persist last tab so direct /admin/forms hits remember the choice, while
  // explicit `?tab=` URLs always win (handled in validateSearch above).
  useMemo(() => {
    try { window.localStorage.setItem(LAST_TAB_KEY, tab); } catch {}
  }, [tab]);

  const setTab = (next: TabKey) => {
    navigate({ to: "/admin/forms", search: { tab: next }, replace: false });
  };

  return (
    <>
      <PageHeader
        title="Forms"
        subtitle="Create, review, and manage forms, submissions, applications, and agreements."
      />
      <div className="border-b border-border bg-background/50">
        <div className="-mb-px flex gap-1 overflow-x-auto px-2 md:px-4">
          {TABS.map((t) => {
            const active = t.value === tab;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setTab(t.value)}
                className={cn(
                  "shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-semibold transition-colors",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
                aria-current={active ? "page" : undefined}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        {tab === "native-forms" && <AdminNativeForms embedded />}
        {tab === "document-forms" && <DocumentFormsPanel embedded />}
        {tab === "fillout-submissions" && <FilloutSubmissionsPage embedded />}
        {tab === "coaching-applications" && <ApplicationsInbox embedded />}
        {tab === "agreements" && <AgreementsAdminPage embedded />}
      </div>
    </>
  );
}

export function DocumentFormsPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const qc = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<FormLink | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FormLink | null>(null);
  const [assignTarget, setAssignTarget] = useState<FormLink | null>(null);

  const { data: forms = [], isLoading } = useQuery({
    queryKey: ["forms-list", showArchived],
    queryFn: () => listForms({ includeArchived: showArchived }),
  });

  function refresh() { qc.invalidateQueries({ queryKey: ["forms-list"] }); }

  function copyUrl(url: string) {
    navigator.clipboard.writeText(url).then(() => toast.success("Link copied"));
  }

  return (
    <>
      {!embedded && (
        <PageHeader title="Forms" subtitle="Store and organize Fillout-style forms. Assign them to clients." />
      )}
      <div className="p-4 md:p-8 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Button variant={showArchived ? "outline" : "default"} size="sm" onClick={() => setShowArchived(false)}>Active</Button>
            <Button variant={showArchived ? "default" : "outline"} size="sm" onClick={() => setShowArchived(true)}>Include archived</Button>
          </div>
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> New Form
          </Button>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : forms.length === 0 ? (
          <Card className="border-border bg-card p-8 text-center">
            <FileEdit className="mx-auto h-8 w-8 text-muted-foreground" />
            <div className="mt-3 font-semibold">No forms yet</div>
            <p className="text-sm text-muted-foreground">Add your first Fillout form link.</p>
          </Card>
        ) : (
          <div className="grid gap-3">
            {forms.map((f) => (
              <Card key={f.id} className="border-border bg-card p-4">
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="font-bold truncate">{f.title}</div>
                      <Badge variant="outline" className="text-xs">{f.form_type}{f.custom_type ? `: ${f.custom_type}` : ""}</Badge>
                      {f.visible_to_client && <Badge variant="outline" className="text-xs border-emerald-500/40 bg-emerald-500/10 text-emerald-300">Visible to all clients</Badge>}
                      {!f.active && <Badge variant="outline" className="text-xs border-amber-500/40 bg-amber-500/10 text-amber-300">Inactive</Badge>}
                      {f.archived && <Badge variant="outline" className="text-xs">Archived</Badge>}
                    </div>
                    {f.description && <p className="mt-1 text-sm text-muted-foreground">{f.description}</p>}
                    <div className="mt-1 text-xs text-muted-foreground truncate">{f.url}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => copyUrl(f.url)}><Copy className="h-3.5 w-3.5" /></Button>
                    <a href={f.url} target="_blank" rel="noreferrer"><Button size="sm"><ExternalLink className="mr-1 h-3.5 w-3.5" />Open</Button></a>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button size="sm" variant="ghost"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { setEditing(f); setDialogOpen(true); }}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setAssignTarget(f)}><Users className="mr-2 h-4 w-4" />Assign to clients</DropdownMenuItem>
                        <DropdownMenuItem onClick={async () => { await archiveForm(f.id, !f.archived); refresh(); toast.success(f.archived ? "Restored" : "Archived"); }}>
                          {f.archived ? <><ArchiveRestore className="mr-2 h-4 w-4" />Restore</> : <><Archive className="mr-2 h-4 w-4" />Archive</>}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(f)}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <FormLinkDialog open={dialogOpen} onOpenChange={setDialogOpen} initial={editing} onSaved={refresh} />
      <DoubleConfirmDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
        title="Delete form?"
        message={`This will permanently remove "${deleteTarget?.title}".`}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteForm(deleteTarget.id);
          setDeleteTarget(null);
          refresh();
          toast.success("Deleted");
        }}
      />
      <AssignFormDialog form={assignTarget} onClose={() => setAssignTarget(null)} />
    </>
  );
}

function AssignFormDialog({ form, onClose }: { form: FormLink | null; onClose: () => void }) {
  const qc = useQueryClient();
  const open = !!form;
  const [selected, setSelected] = useState<string>("");

  const { data: clients = [] } = useQuery({
    queryKey: ["clients-select-min"],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id, full_name").eq("archived", false).order("full_name");
      return data ?? [];
    },
  });

  const { data: assignments = [] } = useQuery({
    queryKey: ["form-assignments", form?.id],
    enabled: open && !!form?.id,
    queryFn: () => listFormAssignments(form!.id),
  });

  async function add() {
    if (!selected || !form) return;
    await assignFormToClient(form.id, selected);
    qc.invalidateQueries({ queryKey: ["form-assignments", form.id] });
    setSelected("");
  }

  async function remove(clientId: string) {
    if (!form) return;
    await unassignFormFromClient(form.id, clientId);
    qc.invalidateQueries({ queryKey: ["form-assignments", form.id] });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Assign "{form?.title}" to clients</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger className="flex-1"><SelectValue placeholder="Select client…" /></SelectTrigger>
              <SelectContent>
                {clients.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
            <ActionButton onAction={add} disabled={!selected} loadingLabel="Assigning…" successLabel="Assigned" successToast="Client assigned">
              Assign
            </ActionButton>
          </div>
          <div className="space-y-1">
            {assignments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No clients assigned yet.{form?.visible_to_client ? " This form is also visible to all clients." : ""}</p>
            ) : assignments.map((a: any) => (
              <div key={a.client_id} className="flex items-center justify-between rounded border border-border bg-secondary/30 px-3 py-2 text-sm">
                <span>{a.clients?.full_name ?? a.client_id}</span>
                <Button size="sm" variant="ghost" onClick={() => remove(a.client_id)}><X className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}