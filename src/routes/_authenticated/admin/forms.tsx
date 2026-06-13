import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import { AdminNativeForms } from "./native-forms";
import { FilloutSubmissionsPage } from "./fillout-submissions";
import { ApplicationsInbox } from "./sales.coaching-applications";
import { AgreementsAdminPage } from "./agreements.index";
import { ReviewsTab } from "@/components/forms/reviews-tab";
import { AiSettingsTab } from "@/components/forms/ai-settings-tab";
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
  { value: "reviews",                label: "Reviews" },
  { value: "builder",                label: "Builder" },
  { value: "submissions",            label: "Submissions" },
  { value: "applications",           label: "Applications" },
  { value: "agreements",             label: "Agreements" },
  { value: "integrations",           label: "Integrations" },
  { value: "ai-settings",            label: "AI Settings" },
  // Legacy / hidden keys kept so old links keep working.
  { value: "native-forms",           label: "Native Forms",         hidden: true },
  { value: "document-forms",         label: "Document Forms",       hidden: true },
  { value: "fillout-submissions",    label: "Fillout Submissions",  hidden: true },
  { value: "coaching-applications",  label: "Coaching Applications",hidden: true },
] as const;
type TabKey = typeof TABS[number]["value"];

const LAST_TAB_KEY = "jf-admin-forms-last-tab";

// Legacy tab keys → canonical tabs. Keeps old bookmarks and redirect stubs
// working when the user lands here directly.
const LEGACY_TAB_ALIAS: Record<string, TabKey> = {
  "native-forms": "builder",
  "document-forms": "builder",
  "fillout-submissions": "submissions",
  "coaching-applications": "applications",
};

function isTab(v: unknown): v is TabKey {
  return typeof v === "string" && TABS.some((t) => t.value === v);
}

export const Route = createFileRoute("/_authenticated/admin/forms")({
  validateSearch: (raw: Record<string, unknown>): { tab: TabKey; sub?: string } => {
    const t = raw?.tab;
    const sub = typeof raw?.sub === "string" ? (raw.sub as string) : undefined;
    if (typeof t === "string" && LEGACY_TAB_ALIAS[t]) {
      return { tab: LEGACY_TAB_ALIAS[t], sub };
    }
    if (isTab(t)) return { tab: t, sub };
    // URL takes priority; only consult localStorage when search is missing.
    if (typeof t === "undefined" && typeof window !== "undefined") {
      try {
        const stored = window.localStorage.getItem(LAST_TAB_KEY);
        if (stored && LEGACY_TAB_ALIAS[stored]) return { tab: LEGACY_TAB_ALIAS[stored], sub };
        if (isTab(stored)) return { tab: stored, sub };
      } catch {}
    }
    return { tab: "reviews", sub };
  },
  component: FormsWorkspacePage,
});

function FormsWorkspacePage() {
  const { tab, sub } = Route.useSearch();
  const navigate = useNavigate();

  // Persist last tab so direct /admin/forms hits remember the choice, while
  // explicit `?tab=` URLs always win (handled in validateSearch above).
  useMemo(() => {
    try { window.localStorage.setItem(LAST_TAB_KEY, tab); } catch {}
  }, [tab]);

  const setTab = (next: TabKey) => {
    navigate({ to: "/admin/forms", search: { tab: next }, replace: false });
  };

  const visibleTabs = TABS.filter((t) => !("hidden" in t && (t as any).hidden));

  return (
    <>
      <PageHeader
        title="Forms"
        subtitle="One place for forms, submissions, AI-assisted reviews, applications, agreements, and integrations."
      />
      <div className="border-b border-border bg-background/50">
        <div className="-mb-px flex gap-1 overflow-x-auto px-2 md:px-4">
          {visibleTabs.map((t) => {
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
        {tab === "reviews" && <ReviewsTab />}
        {tab === "builder" && <BuilderRouter sub={sub} />}
        {tab === "submissions" && <SubmissionsRouter sub={sub} />}
        {tab === "applications" && <ApplicationsInbox embedded />}
        {tab === "agreements" && <AgreementsAdminPage embedded />}
        {tab === "integrations" && <IntegrationsPanel />}
        {tab === "ai-settings" && <AiSettingsTab />}
      </div>
    </>
  );
}

/**
 * Builder tab sub-router. `sub` query param selects between native forms,
 * document forms, and check-in style forms — keeping legacy deep-links alive.
 */
function BuilderRouter({ sub }: { sub?: string }) {
  const navigate = useNavigate();
  const current: "native" | "document" | "check-ins" =
    sub === "document-forms" ? "document" : sub === "check-ins" ? "check-ins" : "native";
  const setSub = (next: "native" | "document" | "check-ins") => {
    navigate({
      to: "/admin/forms",
      search: { tab: "builder", sub: next === "native" ? undefined : (next === "document" ? "document-forms" : "check-ins") },
    });
  };
  return (
    <>
      <div className="border-b border-border bg-background/30 px-2 md:px-4 py-2 flex gap-1">
        <SubTab active={current === "native"} onClick={() => setSub("native")} label="Native forms" />
        <SubTab active={current === "check-ins"} onClick={() => setSub("check-ins")} label="Check-ins" />
        <SubTab active={current === "document"} onClick={() => setSub("document")} label="Document forms" />
      </div>
      {/* AdminNativeForms hosts native + check-in style forms in its existing builder */}
      {(current === "native" || current === "check-ins") && <AdminNativeForms embedded />}
      {current === "document" && <DocumentFormsPanel embedded />}
    </>
  );
}

function SubmissionsRouter({ sub }: { sub?: string }) {
  const navigate = useNavigate();
  const current: "all" | "fillout" =
    sub === "fillout" ? "fillout" : "all";
  const setSub = (next: "all" | "fillout") => {
    navigate({
      to: "/admin/forms",
      search: { tab: "submissions", sub: next === "all" ? undefined : "fillout" },
    });
  };
  return (
    <>
      <div className="border-b border-border bg-background/30 px-2 md:px-4 py-2 flex gap-1">
        <SubTab active={current === "all"} onClick={() => setSub("all")} label="All sources" />
        <SubTab active={current === "fillout"} onClick={() => setSub("fillout")} label="Fillout only" />
      </div>
      {current === "all" && <ReviewsTab />}
      {current === "fillout" && <FilloutSubmissionsPage embedded />}
    </>
  );
}

function SubTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
        active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function IntegrationsPanel() {
  return (
    <div className="p-4 md:p-6 space-y-3 max-w-3xl">
      <Card className="p-5">
        <div className="text-sm font-bold mb-1">Fillout</div>
        <p className="text-xs text-muted-foreground mb-3">
          Fillout submissions are ingested through the webhook at
          <code className="mx-1 rounded bg-muted px-1 py-0.5 text-[11px]">/api/public/hooks/fillout</code>.
          Unmatched submissions appear in <strong>Submissions → Fillout only</strong>.
        </p>
        <a
          href="/admin/forms?tab=submissions&sub=fillout"
          className="text-xs font-semibold text-primary hover:underline"
        >
          Open Fillout submissions →
        </a>
      </Card>
      <Card className="p-5">
        <div className="text-sm font-bold mb-1">SignNow</div>
        <p className="text-xs text-muted-foreground mb-3">
          Agreement signing is handled through SignNow. The webhook lives at
          <code className="mx-1 rounded bg-muted px-1 py-0.5 text-[11px]">/api/public/signnow-webhook</code>.
        </p>
        <a
          href="/admin/forms?tab=agreements"
          className="text-xs font-semibold text-primary hover:underline"
        >
          Open Agreements →
        </a>
      </Card>
    </div>
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