import { useEffect, useMemo, useState, type ReactNode } from "react";
import { quickAnswers, quickExclusive } from "@/lib/form-quick";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Plus, Trash2, Copy, GripVertical, FileEdit, ChevronUp, ChevronDown, Archive, ExternalLink, Search, Eye, Send, Star, Inbox, MoreHorizontal, CheckSquare, Settings2, Check } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { countsLine } from "@/lib/form-response-status";
import { supabase } from "@/integrations/supabase/client";
import {
  listForms, listFormLastUsed, upsertForm, duplicateForm, archiveForm,
  listQuestions, upsertQuestion, deleteQuestion, reorderQuestions,
  listAssignments,
  NF_QUESTION_TYPES, NF_QUESTION_TYPE_LABEL,
  type NfForm, type NfQuestion, type NfQuestionType, type NfRecurrence, type NfKind, type NfOpenStyle,
} from "@/lib/native-forms";
import { deleteNativeForms, replaceNativeFormAssignments, updateNativeFormAccess } from "@/lib/native-forms.functions";
import { syncFilloutForms } from "@/lib/fillout-sync.functions";
import { useBulkSelection } from "@/hooks/use-bulk-selection";
import { FORM_UNUSED_DAYS } from "@/lib/form-submissions";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { ActionButton } from "@/components/action-button";
import { NativeFormPreviewDialog } from "@/components/forms/native-form-preview";
import { ConditionalLogicEditor } from "@/components/forms/conditional-logic-editor";
import { FormVersionHistory } from "@/components/forms/form-version-history";
import { AnswerSourceEditor, ChecklistItemsEditor, ReadinessFieldsEditor } from "@/components/forms/question-extras-editor";
import { FormResponses, FormResponsesSheet } from "@/components/forms/form-responses";
import { CATEGORY_SUGGESTIONS, categoryOf, libraryCategories, matchesSearch, ownerLabel, type LibraryForm } from "@/lib/form-library";
import { FORM_LIBRARY_KEY, useFormFavorites, useFormLibraryStats, useToggleFavorite, type FormStats } from "@/lib/form-library.queries";
import { NewFormFlow } from "@/components/forms/new-form-flow";
import { useAuth } from "@/lib/auth";

const EMPTY_ARRAY: any[] = [];

export function NativeFormsRedirect() {
  const nav = useNavigate();
  useEffect(() => {
    nav({ to: "/admin/forms", search: { tab: "native-forms" } as any, replace: true });
  }, [nav]);
  return null;
}

export function AdminNativeForms({ embedded = false }: { embedded?: boolean } = {}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [editing, setEditing] = useState<NfForm | null>(null);
  const [editTab, setEditTab] = useState<EditorTab>("settings");
  const [creating, setCreating] = useState<NfKind | null>(null);
  const [newNative, setNewNative] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const { data: stats = new Map() } = useFormLibraryStats();
  const { data: favorites = new Set<string>() } = useFormFavorites(user?.id);
  const toggleFavorite = useToggleFavorite(user?.id);
  const deleteFormsFn = useServerFn(deleteNativeForms);
  const syncFilloutFn = useServerFn(syncFilloutForms);
  const [syncing, setSyncing] = useState(false);

  async function handleSyncFillout() {
    setSyncing(true);
    try {
      const r = await syncFilloutFn();
      if (!r.ok) {
        toast.error(r.error ?? "Fillout sync failed");
        return;
      }
      await qc.invalidateQueries({ queryKey: ["nf-forms"] });
      toast.success(`Fillout: ${r.fetched} forms · ${r.created} new · ${r.updated} updated`);
    } catch (e: any) {
      toast.error(e?.message ?? "Fillout sync failed");
    } finally {
      setSyncing(false);
    }
  }

  const { data: forms = [] } = useQuery({ queryKey: ["nf-forms"], queryFn: () => listForms({ includeArchived: true }) });
  const { data: lastUsed = new Map<string, string>() } = useQuery({ queryKey: ["nf-forms-last-used"], queryFn: listFormLastUsed, staleTime: 60_000 });
  // Forms in use first, most recently used on top; archived ones folded away at the bottom.
  const usedAt = (f: NfForm) => lastUsed.get(f.id) ?? f.created_at;
  const libraryShape = forms as unknown as LibraryForm[];
  const categories = useMemo(() => libraryCategories(libraryShape), [forms]);
  const hasOthers = forms.some((f) => f.owner_id && f.owner_id !== user?.id);
  const liveForms = useMemo(
    () =>
      forms
        .filter((f) => !f.archived)
        .filter((f) => matchesSearch(f as unknown as LibraryForm, search))
        .filter((f) =>
          search.trim()
            ? true
            : filter === "favorites"
              ? favorites.has(f.id)
              : filter === "review"
                ? (stats.get(f.id)?.to_review ?? 0) > 0
                : filter === "mine"
                ? f.owner_id === user?.id
                : filter.startsWith("cat:")
                  ? categoryOf(f) === filter.slice(4)
                  : true,
        )
        .sort((a, b) => Number(favorites.has(b.id)) - Number(favorites.has(a.id)) || usedAt(b).localeCompare(usedAt(a))),
    [forms, lastUsed, search, filter, favorites, user?.id, stats],
  );
  const toReviewForms = forms.filter((f) => !f.archived && (stats.get(f.id)?.to_review ?? 0) > 0).length;
  const archivedForms = useMemo(() => forms.filter((f) => f.archived).sort((a, b) => (b.archived_at ?? b.updated_at).localeCompare(a.archived_at ?? a.updated_at)), [forms]);
  const [showArchived, setShowArchived] = useState(false);
  const formSelection = useBulkSelection(useMemo(() => forms.filter((form) => !form.settings?.system_setup).map((form) => form.id), [forms]));

  async function deleteSelectedForms() {
    if (formSelection.count === 0) return;
    if (!confirm(`Delete ${formSelection.count} selected form${formSelection.count === 1 ? "" : "s"}? This cannot be undone.`)) return;
    try {
      const result = await deleteFormsFn({ data: { formIds: formSelection.selectedIds } });
      if (!result.ok) {
        toast.error(result.error ?? "Forms could not be deleted");
        return;
      }
      formSelection.clear();
      await qc.invalidateQueries({ queryKey: ["nf-forms"] });
      await qc.invalidateQueries({ queryKey: ["nf-forms-for-client"] });
      toast.success(`Deleted ${result.count} form${result.count === 1 ? "" : "s"}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Forms could not be deleted");
    }
  }

  async function handleCreate(kind: NfKind) {
    if (kind === "native") {
      // blank, drafted with AI, or a copy of a template
      setCreating(null);
      setNewNative(true);
      return;
    }
    const id = await upsertForm({
      title: kind === "external" ? "Untitled External Form" : "Untitled Form",
      form_type: "check_in",
      recurrence: "none",
      active: false,
      kind,
      open_style: "embed",
      visibility: "selected",
    });
    qc.invalidateQueries({ queryKey: ["nf-forms"] });
    const created = await listForms({ includeArchived: true });
    setEditing(created.find((f) => f.id === id) ?? null);
    setCreating(null);
  }

  const [selecting, setSelecting] = useState(false);
  const [responsesFor, setResponsesFor] = useState<NfForm | null>(null);
  const rowProps = (f: NfForm) => ({
    form: f,
    stats: stats.get(f.id) ?? null,
    favorite: favorites.has(f.id),
    onToggleFavorite: (on: boolean) => toggleFavorite(f.id, on).catch((e: any) => toast.error(e?.message ?? "Couldn't save")),
    ownerTag: ownerLabel(f as unknown as LibraryForm, user?.id),
    onResponses: () => setResponsesFor(f),
    lastUsedAt: lastUsed.get(f.id) ?? null,
    selecting,
    selected: formSelection.isSelected(f.id),
    onSelect: (checked: boolean) => formSelection.setOne(f.id, checked),
    onEdit: () => { setEditTab(f.kind === "native" ? "questions" : "settings"); setEditing(f); },
    onSettings: () => { setEditTab("settings"); setEditing(f); },
    onSend: () => { setEditTab("shared"); setEditing(f); },
  });

  return (
    <>
      {!embedded && <PageHeader title="Forms" />}
      <div className="mx-auto max-w-3xl space-y-3 p-4 md:p-6">
        {/* Search, New form, and everything used now and then in one menu. */}
        <div className="flex items-center gap-2" data-form-library-toolbar>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search forms" className="h-11 pl-9 text-[16px]" aria-label="Search forms" />
          </div>
          <Button onClick={() => setCreating("native")} className="h-11 shrink-0 font-semibold" data-new-form>
            <Plus className="h-4 w-4 sm:mr-1.5" /> <span className="hidden sm:inline">New form</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" aria-label="More">
                <MoreHorizontal className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => { setSelecting(true); }} disabled={!forms.length}>
                <CheckSquare className="mr-2 h-4 w-4" /> Select forms
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleSyncFillout} disabled={syncing}>
                <ExternalLink className="mr-2 h-4 w-4" /> {syncing ? "Syncing from Fillout…" : "Sync from Fillout"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {forms.length > 0 && !search.trim() && (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0" data-form-library-filters>
            {[
              { key: "all", label: "All" },
              // only while something's waiting on the coach (unreviewed, last 30 days)
              ...(toReviewForms || filter === "review" ? [{ key: "review", label: `To review · ${toReviewForms}` }] : []),
              { key: "favorites", label: `Favorites${favorites.size ? ` · ${favorites.size}` : ""}` },
              ...(hasOthers ? [{ key: "mine", label: "Mine" }] : []),
              ...categories.map((c) => ({ key: `cat:${c}`, label: c })),
            ].map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setFilter(c.key)}
                aria-pressed={filter === c.key}
                className={`h-9 shrink-0 rounded-full px-3.5 text-[14px] font-medium ${filter === c.key ? "bg-foreground text-background" : "bg-muted text-foreground"}`}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
        {selecting && (
          <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background p-2" data-form-select-bar>
            <label className="flex min-h-[40px] cursor-pointer items-center gap-2 px-1 text-[15px] font-medium">
              <Checkbox
                checked={formSelection.allSelected || (formSelection.someSelected ? "indeterminate" : false)}
                onCheckedChange={formSelection.toggleAll}
                aria-label="Select all"
              />
              {formSelection.count > 0 ? `${formSelection.count} selected` : "Select all"}
            </label>
            <div className="ml-auto flex gap-2">
              <Button variant="destructive" size="sm" className="h-10" onClick={deleteSelectedForms} disabled={formSelection.count === 0}>
                <Trash2 className="mr-1 h-4 w-4" /> Delete
              </Button>
              <Button variant="outline" size="sm" className="h-10" onClick={() => { formSelection.clear(); setSelecting(false); }}>
                Done
              </Button>
            </div>
          </div>
        )}
        {forms.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-[15px] text-muted-foreground">
            No forms yet. Make one built in the app, or link one from Fillout, Typeform or Google Forms.
          </div>
        )}
        {forms.length > 0 && liveForms.length === 0 && (
          <p className="py-6 text-center text-[15px] text-muted-foreground">{search ? "No form matches that." : filter === "favorites" ? "Star a form to keep it here." : filter === "review" ? "Nothing waiting on you." : "Nothing here yet."}</p>
        )}
        {liveForms.length > 0 && (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card" data-form-library-list>
            {liveForms.map((f) => <FormRow key={f.id} {...rowProps(f)} />)}
          </ul>
        )}
        {archivedForms.length > 0 && (
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg px-1 text-left text-[14px] font-medium text-muted-foreground hover:text-foreground"
              aria-expanded={showArchived}
            >
              <span>Archived · {archivedForms.length}</span>
              <span className="flex items-center gap-1 text-[13px] font-normal">
                {showArchived ? "Hide" : "Show"}
                <ChevronDown className={`h-4 w-4 transition-transform ${showArchived ? "rotate-180" : ""}`} />
              </span>
            </button>
            {showArchived && (
              <>
                <p className="px-1 pb-2 text-[13px] text-muted-foreground">Forms nobody's used in {FORM_UNUSED_DAYS / 30} months archive themselves. Their responses stay.</p>
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                  {archivedForms.map((f) => <FormRow key={f.id} {...rowProps(f)} />)}
                </ul>
              </>
            )}
          </div>
        )}
      </div>

      {responsesFor && (
        <FormResponsesSheet formId={responsesFor.id} title={responsesFor.title} open onOpenChange={(o) => !o && setResponsesFor(null)} />
      )}

      {editing && (
        <FormEditorDialog form={editing} open onClose={() => setEditing(null)} initialTab={editTab} />
      )}

      <NewFormDialog open={!!creating} onPick={handleCreate} onClose={() => setCreating(null)} />
      {newNative && (
        <NewFormFlow
          open
          onClose={() => setNewNative(false)}
          onCreated={(form) => {
            setNewNative(false);
            qc.invalidateQueries({ queryKey: ["nf-forms"] });
            qc.invalidateQueries({ queryKey: FORM_LIBRARY_KEY });
            setEditTab("questions");
            setEditing(form);
          }}
        />
      )}
    </>
  );
}

function NewFormDialog({ open, onPick, onClose }: { open: boolean; onPick: (k: NfKind) => void; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Create a form</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <button onClick={() => onPick("native")} className="rounded-lg border border-border bg-card p-4 text-left hover:border-primary hover:bg-secondary/30">
            <FileEdit className="mb-2 h-5 w-5 text-primary" />
            <div className="font-bold">Native Form</div>
            <div className="mt-1 text-xs text-muted-foreground">Build questions inside the app. Answers tracked in-app.</div>
          </button>
          <button onClick={() => onPick("external")} className="rounded-lg border border-border bg-card p-4 text-left hover:border-primary hover:bg-secondary/30">
            <ExternalLink className="mb-2 h-5 w-5 text-primary" />
            <div className="font-bold">External / Embedded</div>
            <div className="mt-1 text-xs text-muted-foreground">Paste a Fillout, Typeform, Google Forms link. Opens inside the app.</div>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FormRow({
  form,
  stats,
  favorite,
  onToggleFavorite,
  ownerTag,
  onResponses,
  lastUsedAt,
  selecting,
  selected,
  onSelect,
  onEdit,
  onSettings,
  onSend,
}: {
  form: NfForm;
  /** From nf_form_library_stats: one read for the whole list. */
  stats: FormStats | null;
  favorite: boolean;
  onToggleFavorite: (on: boolean) => void;
  ownerTag: string | null;
  onResponses: () => void;
  lastUsedAt: string | null;
  selecting: boolean;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  onEdit: () => void;
  onSettings: () => void;
  onSend: () => void;
}) {
  const qc = useQueryClient();
  // Only a preview loads the questions (the list's counts come from the stats).
  const [preview, setPreview] = useState(false);
  const { data: questions = [] } = useQuery({
    queryKey: ["nf-questions", form.id],
    queryFn: () => listQuestions(form.id),
    enabled: form.kind === "native" && preview,
  });

  const systemSetup = form.settings?.system_setup === true;
  const sentCount = stats?.sent ?? 0;
  const hasAudience = form.visibility === "all_active_clients" || sentCount > 0;
  const native = form.kind !== "external";
  const status = libraryStatus(form, stats);
  const meta = [
    categoryOf(form),
    native ? `${stats?.questions ?? 0} questions` : form.external_url ? "External link" : "No link yet",
    form.recurrence !== "none" ? form.recurrence : null,
    lastUsedAt ? `Used ${fmtShort(lastUsedAt)}` : null,
  ].filter(Boolean).join(" · ");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["nf-forms"] });
    qc.invalidateQueries({ queryKey: ["nf-forms-for-client"] });
    qc.invalidateQueries({ queryKey: FORM_LIBRARY_KEY });
  };

  return (
    <li className="flex items-center gap-1.5 px-2 py-2 sm:px-3" data-form-row>
      {selecting ? (
        <span className="grid h-10 w-10 shrink-0 place-items-center">
          <Checkbox checked={selected} disabled={systemSetup} onCheckedChange={(checked) => onSelect(checked === true)} aria-label={`Select ${form.title}`} />
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onToggleFavorite(!favorite)}
          aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={favorite}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <Star className={favorite ? "h-4 w-4 fill-warning text-warning" : "h-4 w-4"} />
        </button>
      )}
      <button type="button" onClick={systemSetup ? onResponses : selecting ? () => onSelect(!selected) : onEdit} className="min-w-0 flex-1 py-1 text-left" data-form-open>
        <span className="block text-[16px] font-semibold leading-snug">
          {form.title}
          {form.archived ? <Tag>Archived</Tag> : !form.active ? <Tag tone="warn">Draft</Tag> : null}
          {!native && <Tag>External</Tag>}
          {systemSetup ? <Tag>System form</Tag> : ownerTag && <Tag>{ownerTag}</Tag>}
        </span>
        <span className="block truncate text-[13px] text-muted-foreground">{meta}</span>
        <span className="block text-[13px] leading-snug" data-form-row-status>
          <span className={status.tone === "muted" ? "text-muted-foreground" : "text-foreground"}>{systemSetup ? `${stats?.responses ?? 0} submissions · Account setup` : status.text}</span>
          {(stats?.to_review ?? 0) > 0 && <span className="font-medium text-sky-700 dark:text-sky-400"> · {stats!.to_review} to review</span>}
        </span>
        {hasAudience && !form.archived && !form.active && (
          <span className="mt-0.5 block text-[13px] font-medium text-warning">Sent, but clients can't open it while it's a draft.</span>
        )}
        {form.archived && form.archived_reason === "unused" && (
          <span className="mt-0.5 block text-[13px] text-muted-foreground">Archived on its own: not used in {FORM_UNUSED_DAYS / 30} months.</span>
        )}
      </button>
      {native && !selecting && (
        <Button variant="outline" size="sm" className="h-10 shrink-0 px-2.5 sm:px-3" onClick={onResponses} aria-label={`Responses to ${form.title}`} data-form-responses-open>
          <Inbox className="h-4 w-4 sm:mr-1.5" />
          <span className="hidden sm:inline">Responses</span>
          {(stats?.responses ?? 0) > 0 && <span className="ml-1 tabular-nums text-muted-foreground">{stats!.responses}</span>}
        </Button>
      )}
      {!selecting && systemSetup && (
        <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" onClick={() => setPreview(true)} aria-label={`Preview ${form.title}`}><Eye className="h-4 w-4" /></Button>
      )}
      {!selecting && !systemSetup && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" aria-label={`More for ${form.title}`}>
              <MoreHorizontal className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onSend}><Send className="mr-2 h-4 w-4" /> Share with clients</DropdownMenuItem>
            {native && <DropdownMenuItem onClick={() => setPreview(true)}><Eye className="mr-2 h-4 w-4" /> Preview</DropdownMenuItem>}
            <DropdownMenuItem onClick={onSettings}><Settings2 className="mr-2 h-4 w-4" /> Settings</DropdownMenuItem>
            {!form.archived && !form.active && hasAudience && (
              <DropdownMenuItem
                onClick={async () => {
                  await upsertForm({ id: form.id, active: true });
                  refresh();
                  toast.success("Switched on: clients can open it now");
                }}
              >
                <Check className="mr-2 h-4 w-4" /> Switch it on
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={async () => {
                try {
                  await duplicateForm(form.id);
                  refresh();
                  toast.success("Copied. The copy is yours to change.");
                } catch (e: any) {
                  toast.error(e?.message ?? "Couldn't copy it");
                }
              }}
            >
              <Copy className="mr-2 h-4 w-4" /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                await archiveForm(form.id, !form.archived);
                refresh();
                toast.success(form.archived ? "Back in your forms" : "Archived. Its responses stay.");
              }}
            >
              <Archive className="mr-2 h-4 w-4" /> {form.archived ? "Unarchive" : "Archive"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {preview && native && (
        <NativeFormPreviewDialog open={preview} onClose={() => setPreview(false)} form={form} questions={questions} />
      )}
    </li>
  );
}

function Tag({ children, tone }: { children: ReactNode; tone?: "warn" }) {
  return (
    <span className={`ml-1.5 inline-block translate-y-[-1px] whitespace-nowrap rounded-full px-2 py-0.5 align-middle text-[11px] font-medium ${tone === "warn" ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground"}`}>
      {children}
    </span>
  );
}

const fmtShort = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
};

/** The row's one line about who it's out with, on the same rule as the responses viewer. */
function libraryStatus(form: NfForm, stats: FormStats | null): { text: string; tone: "muted" | "normal" } {
  const sent = stats?.sent ?? 0;
  if (form.visibility === "all_active_clients") {
    const line = sent ? countsLine({ people: sent, answered: stats?.done ?? 0, inProgress: stats?.in_progress ?? 0, waiting: stats?.waiting ?? 0 }) : null;
    return { text: `Every active client${line ? ` · ${line}` : ""}`, tone: "normal" };
  }
  if (!sent) return { text: "Not sent yet", tone: "muted" };
  return {
    text: `Sent to ${sent} · ${countsLine({ people: sent, answered: stats?.done ?? 0, inProgress: stats?.in_progress ?? 0, waiting: stats?.waiting ?? 0 })}`,
    tone: "normal",
  };
}

type EditorTab = "settings" | "questions" | "shared" | "versions" | "responses";

export function FormEditorDialog({ form, open, onClose, initialTab = "settings" }: { form: NfForm; open: boolean; onClose: () => void; initialTab?: EditorTab }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [local, setLocal] = useState<NfForm>(form);
  const [activeTab, setActiveTab] = useState<EditorTab>(initialTab);
  const [preview, setPreview] = useState(false);
  // A team form or a colleague's is read-only here: a copy is theirs to change.
  const { data: canEdit = true } = useQuery({
    queryKey: ["nf-can-edit", form.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("nf_can_edit_form", { _form_id: form.id });
      if (error) return true;
      return !!data;
    },
    staleTime: 60_000,
  });
  const mine = !form.owner_id || form.owner_id === user?.id;

  const { data: questions = [] } = useQuery({
    queryKey: ["nf-questions", form.id],
    queryFn: () => listQuestions(form.id),
    enabled: form.kind === "native",
  });

  async function saveSettings() {
    const patch = {
      title: local.title,
      description: local.description,
      form_type: local.form_type,
      recurrence: local.recurrence,
      recurrence_day: local.recurrence_day,
      active: local.active,
      archived: local.archived,
      kind: local.kind,
      external_url: local.external_url,
      button_label: local.button_label,
      open_style: local.open_style,
      visibility: local.visibility,
      auto_assign_new_clients: local.auto_assign_new_clients,
      requires_client_identity: local.requires_client_identity,
      popup_enabled: local.popup_enabled ?? false,
      popup_weekdays: local.popup_weekdays ?? [],
      popup_start_time: local.popup_start_time ?? null,
      popup_end_time: local.popup_end_time ?? null,
      popup_start_date: local.popup_start_date ?? null,
      popup_end_date: local.popup_end_date ?? null,
      category: local.category?.trim() || null,
      allow_updates: !!local.allow_updates,
      shared: !!local.shared,
    };
    await upsertForm({ id: form.id, ...patch } as any);
    qc.invalidateQueries({ queryKey: ["nf-forms"] });
    qc.invalidateQueries({ queryKey: ["nf-forms-for-client"] });
    qc.invalidateQueries({ queryKey: FORM_LIBRARY_KEY });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        showBackButton={false}
        className="fixed inset-0 left-0 top-0 flex h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:left-1/2 sm:top-1/2 sm:h-[min(92dvh,960px)] sm:max-w-3xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border"
        data-form-editor
      >
        <header className="shrink-0 border-b border-border px-2 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] sm:pt-2">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" onClick={onClose} aria-label="Back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-[17px] font-semibold">{local.title || "Untitled form"}</DialogTitle>
              <p className="text-[13px] text-muted-foreground">{form.kind === "external" ? "External form" : `${questions.length} question${questions.length === 1 ? "" : "s"}`}</p>
            </div>
            {form.kind === "native" && (
              <Button type="button" variant="outline" size="sm" className="h-10 shrink-0" onClick={() => setPreview(true)}>
                <Eye className="h-4 w-4 sm:mr-1.5" /> <span className="hidden sm:inline">Preview</span>
              </Button>
            )}
          </div>
          {/* Questions first: it's what's edited most. Neutral tabs, one row that scrolls. */}
          <div className="mt-2 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none]" role="tablist" aria-label="Form editor">
            {([
              ...(form.kind === "native" ? [{ key: "questions" as const, label: "Questions" }] : []),
              { key: "settings" as const, label: "Settings" },
              { key: "shared" as const, label: "Shared with" },
              { key: "responses" as const, label: "Responses" },
              ...(form.kind === "native" ? [{ key: "versions" as const, label: "Versions" }] : []),
            ]).map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={activeTab === t.key}
                onClick={() => setActiveTab(t.key)}
                className={`h-9 shrink-0 rounded-full px-3.5 text-[14px] font-medium ${activeTab === t.key ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                data-editor-tab={t.key}
              >
                {t.label}
              </button>
            ))}
          </div>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-4">

          {!canEdit && (
            <p className="rounded-lg bg-muted px-3 py-2 text-[13px]" data-form-read-only>
              {form.is_template ? "This is a team template." : "This is a team form."} You can send it, preview it and see its answers. To change it, make a copy from your library: the copy is yours.
            </p>
          )}

          {activeTab === "settings" && <div className="space-y-3">
            <div>
              <Label>Title</Label>
              <Input value={local.title} onChange={(e) => setLocal({ ...local, title: e.target.value })} />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea rows={2} value={local.description ?? ""} onChange={(e) => setLocal({ ...local, description: e.target.value })} />
            </div>

            {local.kind === "external" && (
              <div className="space-y-3 rounded-lg border border-border bg-secondary/10 p-3">
                <div>
                  <Label>Form URL</Label>
                  <Input
                    placeholder="https://forms.fillout.com/... or https://forms.gle/..."
                    value={local.external_url ?? ""}
                    onChange={(e) => setLocal({ ...local, external_url: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Button label</Label>
                    <Input
                      placeholder="Submit Weekly Check-In"
                      value={local.button_label ?? ""}
                      onChange={(e) => setLocal({ ...local, button_label: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Open style</Label>
                    <Select value={local.open_style} onValueChange={(v) => setLocal({ ...local, open_style: v as NfOpenStyle })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="embed">Embed in app (iframe)</SelectItem>
                        <SelectItem value="modal">Open in app browser modal</SelectItem>
                        <SelectItem value="new_tab">Open in a new tab</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {local.external_url && (
                  <a href={local.external_url} target="_blank" rel="noreferrer" className="inline-flex items-center text-xs text-primary hover:underline">
                    <Eye className="mr-1 h-3 w-3" /> Preview external form
                  </a>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Note: some providers (Google Forms, certain Typeform/Fillout settings) block embedding. If embed fails the app will fall back to opening the link.
                </p>
                <label className="flex items-start gap-2 rounded-md border border-border bg-background p-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4"
                    checked={local.requires_client_identity ?? true}
                    onChange={(e) => setLocal({ ...local, requires_client_identity: e.target.checked })}
                  />
                  <span>
                    <span className="font-semibold">Auto-attach client identity</span>
                    <span className="block text-muted-foreground">
                      Appends <code>client_id</code>, <code>client_email</code>, <code>first_name</code>, <code>last_name</code>
                      to Fillout URLs so submissions match the logged-in client automatically. Leave on unless this form is shared publicly.
                    </span>
                  </span>
                </label>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Recurrence</Label>
                <Select value={local.recurrence} onValueChange={(v) => setLocal({ ...local, recurrence: v as NfRecurrence })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">One-time</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="biweekly">Bi-weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Due day</Label>
                <Select value={local.recurrence_day ?? ""} onValueChange={(v) => setLocal({ ...local, recurrence_day: v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="nf-category">Category</Label>
              <Input id="nf-category" list="nf-category-list" value={local.category ?? ""} maxLength={60} placeholder="Custom Forms" onChange={(e) => setLocal({ ...local, category: e.target.value })} />
              <datalist id="nf-category-list">
                {CATEGORY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={local.active} onCheckedChange={(v) => setLocal({ ...local, active: v })} />
              <Label>Active (clients can submit)</Label>
            </div>
            {local.kind === "native" && (
              <div className="flex items-start gap-2">
                <Switch checked={!!local.allow_updates} onCheckedChange={(v) => setLocal({ ...local, allow_updates: v })} />
                <div>
                  <Label>They can keep updating it after they send it</Label>
                  <p className="text-xs text-muted-foreground">For checklists: they change an item as they sort it, without a new form. You see every change.</p>
                </div>
              </div>
            )}
            {mine && !form.is_template && (
              <div className="flex items-start gap-2">
                <Switch checked={!!local.shared} onCheckedChange={(v) => setLocal({ ...local, shared: v })} />
                <div>
                  <Label>Share with your team</Label>
                  <p className="text-xs text-muted-foreground">Other coaches can send it and copy it. Only you can change it.</p>
                </div>
              </div>
            )}
            <PopupConfigEditor local={local} setLocal={setLocal} />
            <div className="flex justify-end">
              <ActionButton onAction={saveSettings} loadingLabel="Saving…" successLabel="Saved" successToast="Form saved">
                Save
              </ActionButton>
            </div>
          </div>}

          {activeTab === "questions" && form.kind === "native" && (
            <div>
              <QuestionsEditor formId={form.id} questions={questions} />
            </div>
          )}

          {activeTab === "shared" && <div>
            <AssignmentsEditor formId={form.id} form={local} onFormChange={setLocal} />
          </div>}

          {activeTab === "versions" && form.kind === "native" && (
            <FormVersionHistory formId={form.id} />
          )}

          {activeTab === "responses" && <FormResponses formId={form.id} />}
        </div>
      </DialogContent>
      {preview && form.kind === "native" && (
        <NativeFormPreviewDialog
          open={preview}
          onClose={() => setPreview(false)}
          form={local}
          questions={questions}
        />
      )}
    </Dialog>
  );
}

function QuestionsEditor({ formId, questions }: { formId: string; questions: NfQuestion[] }) {
  const qc = useQueryClient();

  async function addQuestion() {
    await upsertQuestion({
      form_id: formId,
      order_index: (questions[questions.length - 1]?.order_index ?? 0) + 1,
      question_type: "short_text",
      label: "New question",
      required: false,
      options: [],
    } as any);
    qc.invalidateQueries({ queryKey: ["nf-questions", formId] });
  }

  async function move(idx: number, dir: -1 | 1) {
    const next = idx + dir;
    if (next < 0 || next >= questions.length) return;
    const updates = [
      { id: questions[idx].id, order_index: questions[next].order_index },
      { id: questions[next].id, order_index: questions[idx].order_index },
    ];
    await reorderQuestions(updates);
    qc.invalidateQueries({ queryKey: ["nf-questions", formId] });
  }

  return (
    <div className="space-y-2">
      {questions.map((q, idx) => (
        <QuestionRow key={q.id} q={q} formId={formId} allQuestions={questions} onMoveUp={() => move(idx, -1)} onMoveDown={() => move(idx, 1)} />
      ))}
      <Button variant="outline" className="h-11 w-full" onClick={addQuestion}><Plus className="mr-1.5 h-4 w-4" /> Add a question</Button>
    </div>
  );
}

function QuestionRow({ q, formId, allQuestions, onMoveUp, onMoveDown }: { q: NfQuestion; formId: string; allQuestions: NfQuestion[]; onMoveUp: () => void; onMoveDown: () => void }) {
  const qc = useQueryClient();
  const [local, setLocal] = useState<NfQuestion>(q);

  async function save(patch: Partial<NfQuestion>) {
    const next = { ...local, ...patch };
    setLocal(next);
    await upsertQuestion({ id: q.id, form_id: formId, ...patch } as any);
    qc.invalidateQueries({ queryKey: ["nf-questions", formId] });
  }

  const v0 = (local.validation ?? {}) as Record<string, unknown>;
  const fromOther = typeof v0.options_from === "string" && !!v0.options_from;
  const needsOptions = ["single_choice", "multi_choice", "dropdown", "competitions"].includes(local.question_type) || (local.question_type === "ranking" && !fromOther);
  const answerable = local.question_type !== "info";
  // Questions a choice or ranking can take its items from: the competitions asked earlier in the form.
  const meetSources = allQuestions.filter((x) => x.question_type === "competitions" && x.id !== q.id);
  const canTakeFrom = ["single_choice", "dropdown", "ranking"].includes(local.question_type) && meetSources.length > 0;
  // one-tap answers above a typed answer, and a number's sanity range (nf_questions.validation)
  const canQuick = ["short_text", "long_text", "number"].includes(local.question_type);
  const v = (local.validation ?? {}) as Record<string, unknown>;
  const [quickDraft, setQuickDraft] = useState(() => quickAnswers(q).join(", "));
  const saveValidation = (patch: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...v, ...patch };
    for (const k of Object.keys(next)) if (next[k] == null || next[k] === "" || (Array.isArray(next[k]) && !(next[k] as unknown[]).length)) delete next[k];
    void save({ validation: next });
  };
  const saveQuick = () => {
    const list = [...new Set(quickDraft.split(",").map((x) => x.trim()).filter(Boolean))].slice(0, 12);
    // a stand-alone answer ("None") stays stand-alone while it's still there
    saveValidation({ quick: list, quick_exclusive: quickExclusive(q).filter((x) => list.includes(x)) });
  };
  const formHasChecklist = allQuestions.some((x) => x.question_type === "checklist");
  const areaKeys = [...new Set(allQuestions.map((x) => (x.validation as any)?.area).filter((a): a is string => typeof a === "string" && !!a))];
  const numberField = (key: "min" | "max") => {
    const raw = v[key];
    return raw == null ? "" : String(raw);
  };

  return (
    <Card className="border-border bg-card p-3">
      <div className="flex items-start gap-2">
        <div className="-ml-1 flex flex-col items-center">
          <button type="button" onClick={onMoveUp} aria-label="Move up" className="grid h-9 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><ChevronUp className="h-4 w-4" /></button>
          <GripVertical className="h-4 w-4 text-muted-foreground/60" aria-hidden />
          <button type="button" onClick={onMoveDown} aria-label="Move down" className="grid h-9 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><ChevronDown className="h-4 w-4" /></button>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input className="text-[16px] sm:text-sm" value={local.label} onChange={(e) => setLocal({ ...local, label: e.target.value })} onBlur={() => save({ label: local.label })} aria-label="Question" />
            <Select value={local.question_type} onValueChange={(v) => save({ question_type: v as NfQuestionType })}>
              <SelectTrigger className="w-full sm:w-44" aria-label="Answer type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {NF_QUESTION_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{NF_QUESTION_TYPE_LABEL[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input
            placeholder={answerable ? "Help text under the question (optional)" : "Text under the heading (optional)"}
            defaultValue={local.help_text ?? ""}
            onBlur={(e) => {
              const next = e.target.value.trim() || null;
              if (next !== (local.help_text ?? null)) void save({ help_text: next });
            }}
          />
          {canTakeFrom && (
            <Select value={fromOther ? String(v0.options_from) : "__own"} onValueChange={(x) => saveValidation({ options_from: x === "__own" ? null : x })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__own">Its own options</SelectItem>
                {meetSources.map((m) => (
                  <SelectItem key={m.id} value={m.id}>Meets picked in: {m.label.slice(0, 50)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {needsOptions && !(fromOther && local.question_type !== "ranking") && (
            <Input
              placeholder={local.question_type === "competitions" ? "Meet levels (comma-separated)" : "Options (comma-separated)"}
              value={(local.options ?? []).join(", ")}
              onChange={(e) => setLocal({ ...local, options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              onBlur={() => save({ options: local.options })}
            />
          )}
          {local.question_type === "competitions" && (
            <Input
              placeholder={'The "not competing" option, e.g. None, I\'m not competing (optional)'}
              defaultValue={typeof v0.none_option === "string" ? v0.none_option : ""}
              onBlur={(e) => saveValidation({ none_option: e.target.value.trim() || null })}
            />
          )}
          {(local.question_type === "single_choice" || local.question_type === "dropdown") && !fromOther && (
            <Input
              placeholder="Show in groups by how options start, e.g. Men's, Women's (optional)"
              defaultValue={Array.isArray(v0.group_prefixes) ? (v0.group_prefixes as string[]).join(", ") : ""}
              onBlur={(e) => saveValidation({ group_prefixes: e.target.value.split(",").map((x) => x.trim()).filter(Boolean).map((x) => `${x} `) })}
            />
          )}
          {canQuick && (
            <div>
              <Input
                placeholder={local.question_type === "number" ? "Quick numbers they can tap, e.g. 3, 4, 5 (optional)" : "Quick answers they can tap, e.g. None, Walking, Sports (optional)"}
                value={quickDraft}
                onChange={(e) => setQuickDraft(e.target.value)}
                onBlur={saveQuick}
                data-quick-answers-input
              />
              <p className="mt-1 text-[11px] text-muted-foreground">Shown as buttons above the box. They can tap one or more and still type their own.</p>
            </div>
          )}
          {local.question_type === "number" && (
            <div className="grid grid-cols-3 gap-2">
              <Input inputMode="decimal" placeholder="Min" defaultValue={numberField("min")} onBlur={(e) => saveValidation({ min: e.target.value.trim() === "" ? null : Number(e.target.value) })} />
              <Input inputMode="decimal" placeholder="Max" defaultValue={numberField("max")} onBlur={(e) => saveValidation({ max: e.target.value.trim() === "" ? null : Number(e.target.value) })} />
              <Input placeholder="Unit (lb, steps)" defaultValue={typeof v.unit === "string" ? v.unit : ""} onBlur={(e) => saveValidation({ unit: e.target.value.trim() || null })} />
            </div>
          )}
          {local.question_type === "checklist" && (
            <ChecklistItemsEditor q={local} allQuestions={allQuestions} saveValidation={saveValidation} />
          )}
          {answerable && local.question_type !== "checklist" && <AnswerSourceEditor q={local} saveValidation={saveValidation} />}
          {(local.question_type === "checklist" || (formHasChecklist && ["single_choice", "multi_choice", "dropdown", "number"].includes(local.question_type))) && (
            <ReadinessFieldsEditor q={local} areas={areaKeys} saveValidation={saveValidation} />
          )}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {answerable && (
              <label className="flex items-center gap-1" title={local.question_type === "checklist" ? "Every critical and important item needs marking before they can send it." : undefined}>
                <Checkbox checked={local.required} onCheckedChange={(v) => save({ required: !!v })} /> Required
              </label>
            )}
            {answerable && local.question_type !== "file" && local.question_type !== "video" && (
              <label className="flex items-center gap-1" title="When you send this form again, it opens on what they answered last time.">
                <Checkbox checked={v0.remember === true} onCheckedChange={(x) => saveValidation({ remember: x ? true : null })} /> Start from their last answer
              </label>
            )}
            <Button variant="ghost" size="sm" onClick={async () => {
              await deleteQuestion(q.id);
              qc.invalidateQueries({ queryKey: ["nf-questions", formId] });
            }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
          </div>
          <ConditionalLogicEditor
            question={local}
            allQuestions={allQuestions}
            onChange={(cl) => save({ conditional_logic: cl })}
          />
        </div>
      </div>
    </Card>
  );
}

function AssignmentsEditor({ formId, form, onFormChange }: { formId: string; form: NfForm; onFormChange: (f: NfForm) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const impersonation = useClientImpersonation();
  const saveAssignmentsFn = useServerFn(replaceNativeFormAssignments);
  const updateAccessFn = useServerFn(updateNativeFormAccess);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: assignmentsData } = useQuery({ queryKey: ["nf-assignments", formId], queryFn: () => listAssignments(formId) });
  const assignments = assignmentsData ?? EMPTY_ARRAY;
  const { data: clientsData } = useQuery({
    queryKey: ["all-clients-min"],
    queryFn: async () => {
      const { data } = await supabase
        .from("clients")
        .select("id, user_id, full_name, email, status, archived")
        .eq("archived", false)
        .in("status", ["Active", "New Client"])
        .order("full_name");
      return data ?? [];
    },
  });
  const clients = clientsData ?? EMPTY_ARRAY;

  useEffect(() => {
    if (dirty || saving) return;
    setSelectedIds(new Set(assignments.map((a: any) => a.client_id)));
  }, [assignments, dirty, saving]);

  const broadcastOn = form.visibility === "all_active_clients";
  const filtered = clients.filter((c: any) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (c.full_name ?? "").toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q);
  });
  const visibleIds = filtered.map((client: any) => client.id as string);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id: string) => selectedIds.has(id));

  function setClientSelected(clientId: string, checked: boolean) {
    if (broadcastOn || saving) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(clientId);
      else next.delete(clientId);
      return next;
    });
    setDirty(true);
  }

  function toggle(clientId: string) {
    setClientSelected(clientId, !selectedIds.has(clientId));
  }

  function selectAllVisible() {
    if (broadcastOn || saving || visibleIds.length === 0) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of visibleIds) next.add(id);
      return next;
    });
    setDirty(true);
  }

  function clearAll() {
    if (broadcastOn || saving) return;
    setSelectedIds(new Set());
    setDirty(true);
  }

  function previewAsClient(client: any) {
    if (!client.user_id) {
      toast.error("Client has no account yet — send a setup link first.");
      return;
    }
    impersonation.start({ id: client.id, user_id: client.user_id, full_name: client.full_name });
    navigate({ to: "/portal/messages" });
  }

  async function saveAssignmentChanges() {
    setSaving(true);
    try {
      const result = await saveAssignmentsFn({ data: { formId, clientIds: Array.from(selectedIds) } });
      if (!result.ok) {
        toast.error("Assignment save failed", { description: result.error ?? "Assignments could not be saved" });
        return;
      }
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ["nf-assignments", formId] });
      await qc.invalidateQueries({ queryKey: ["nf-forms"] });
      await qc.invalidateQueries({ queryKey: ["nf-forms-for-client"] });
      toast.success(`Saved ${result.count} assignment${result.count === 1 ? "" : "s"}`);
    } catch (e: any) {
      toast.error("Assignment save failed", { description: e?.message ?? "Assignments could not be saved" });
    } finally {
      setSaving(false);
    }
  }

  async function setBroadcast(on: boolean) {
    const previousVisibility = form.visibility;
    const visibility = on ? "all_active_clients" : "selected";
    onFormChange({ ...form, visibility });
    setSaving(true);
    try {
      const result = await updateAccessFn({ data: { formId, visibility } });
      if (!result.ok) {
        onFormChange({ ...form, visibility: previousVisibility });
        toast.error(result.error ?? "Failed");
        return;
      }
      await qc.invalidateQueries({ queryKey: ["nf-forms"] });
      await qc.invalidateQueries({ queryKey: ["nf-assignments", formId] });
      await qc.invalidateQueries({ queryKey: ["nf-forms-for-client"] });
      toast.success(on ? "Now visible to all active clients" : "Switched to selected clients");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function setAutoAssign(on: boolean) {
    const previousAutoAssign = form.auto_assign_new_clients;
    onFormChange({ ...form, auto_assign_new_clients: on });
    setSaving(true);
    try {
      const result = await updateAccessFn({ data: { formId, autoAssignNewClients: on } });
      if (!result.ok) {
        onFormChange({ ...form, auto_assign_new_clients: previousAutoAssign });
        toast.error(result.error ?? "Failed");
        return;
      }
      qc.invalidateQueries({ queryKey: ["nf-forms"] });
      qc.invalidateQueries({ queryKey: ["nf-forms-for-client"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-secondary/10 p-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label className="text-sm font-bold">Share with every active coaching client</Label>
            <p className="text-xs text-muted-foreground">Turn on to grant access to all Active / New clients at once. Otherwise pick individuals below or share via chat.</p>
          </div>
          <Switch checked={broadcastOn} disabled={saving} onCheckedChange={setBroadcast} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label className="text-sm font-bold">Auto-share with new clients</Label>
            <p className="text-xs text-muted-foreground">Future active clients are added to this form automatically.</p>
          </div>
          <Switch checked={form.auto_assign_new_clients} disabled={saving} onCheckedChange={setAutoAssign} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          {broadcastOn
            ? `Shared with every active coaching client (individual ticks are inherited)`
            : `Shared with ${selectedIds.size} client${selectedIds.size === 1 ? "" : "s"}${dirty ? " · unsaved" : ""}`}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={selectAllVisible} disabled={broadcastOn || saving}>{allVisibleSelected ? "All visible selected" : "Select all visible"}</Button>
          <Button variant="ghost" size="sm" onClick={clearAll} disabled={broadcastOn || saving}>Clear all</Button>
          <ActionButton
            size="sm"
            disabled={broadcastOn || saving || !dirty}
            loadingLabel="Saving…"
            successLabel="Saved"
            onAction={saveAssignmentChanges}
          >
            Save shares
          </ActionButton>
        </div>
      </div>

      {form.archived ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Shared, but not visible because this form is archived.
        </div>
      ) : !form.active ? (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          Shared, but not visible because this form is still Draft.
        </div>
      ) : null}

      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search clients…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="max-h-[40vh] space-y-1 overflow-y-auto rounded border border-border p-2">
        {filtered.length === 0 ? (
          <div className="p-3 text-xs text-muted-foreground">No matching clients.</div>
        ) : filtered.map((c: any) => {
          const isChecked = broadcastOn ? true : selectedIds.has(c.id);
          const disabled = broadcastOn || saving;
          return (
            <div
              key={c.id}
              onClick={(e) => {
                if (disabled) return;
                // Ignore clicks that originated from the checkbox itself —
                // it has its own onCheckedChange and we don't want to double-toggle.
                const target = e.target as HTMLElement;
                if (target.closest('[data-nf-checkbox="true"]')) return;
                toggle(c.id);
              }}
              className={`flex min-h-[44px] items-center gap-3 rounded p-2 hover:bg-muted/40 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
            >
              <span data-nf-checkbox="true" className="inline-flex">
                <Checkbox
                  checked={isChecked}
                  disabled={disabled}
                  onCheckedChange={(checked) => setClientSelected(c.id, checked === true)}
                  aria-label={`Assign ${c.full_name}`}
                />
              </span>
              <span className="text-sm">{c.full_name}</span>
              <span className="ml-auto truncate text-xs text-muted-foreground">{c.email}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!c.user_id || dirty || (!broadcastOn && !selectedIds.has(c.id))}
                onClick={(e) => {
                  e.stopPropagation();
                  previewAsClient(c);
                }}
                title={dirty ? "Save assignments before previewing" : undefined}
              >
                <Eye className="mr-1 h-3.5 w-3.5" /> Preview
              </Button>
              {broadcastOn && (
                <span className="ml-2 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">
                  inherited
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------- Popup config -------------------- */

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function PopupConfigEditor({
  local,
  setLocal,
}: {
  local: NfForm;
  setLocal: (f: NfForm) => void;
}) {
  const enabled = !!local.popup_enabled;
  const days = local.popup_weekdays ?? [];

  function toggleDay(d: number) {
    const set = new Set(days);
    if (set.has(d)) set.delete(d);
    else set.add(d);
    setLocal({ ...local, popup_weekdays: Array.from(set).sort() });
  }

  function setAllWeek() {
    setLocal({ ...local, popup_weekdays: [0, 1, 2, 3, 4, 5, 6] });
  }
  function clearDays() {
    setLocal({ ...local, popup_weekdays: [] });
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-secondary/10 p-3">
      <div className="flex items-start gap-2">
        <Switch
          checked={enabled}
          onCheckedChange={(v) => setLocal({ ...local, popup_enabled: v })}
        />
        <div>
          <Label className="text-sm font-semibold">Show as in-app popup</Label>
          <p className="text-[11px] text-muted-foreground">
            Pops up for all active clients on the schedule below. Each client can dismiss it
            (X / Not now); it stays hidden until the next scheduled day.
          </p>
        </div>
      </div>

      {enabled && (
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label className="text-xs">Days of week</Label>
              <div className="flex gap-2 text-[11px]">
                <button type="button" className="text-primary hover:underline" onClick={setAllWeek}>All week</button>
                <button type="button" className="text-muted-foreground hover:underline" onClick={clearDays}>Clear</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_LABELS.map((lbl, i) => {
                const on = days.includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleDay(i)}
                    className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                      on
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {lbl}
                  </button>
                );
              })}
            </div>
            {days.length === 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">No days selected — popup will show every day.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Earliest time</Label>
              <Input
                type="time"
                value={local.popup_start_time ?? ""}
                onChange={(e) => setLocal({ ...local, popup_start_time: e.target.value || null })}
              />
            </div>
            <div>
              <Label className="text-xs">Latest time</Label>
              <Input
                type="time"
                value={local.popup_end_time ?? ""}
                onChange={(e) => setLocal({ ...local, popup_end_time: e.target.value || null })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Start date (optional)</Label>
              <Input
                type="date"
                value={local.popup_start_date ?? ""}
                onChange={(e) => setLocal({ ...local, popup_start_date: e.target.value || null })}
              />
            </div>
            <div>
              <Label className="text-xs">End date (optional)</Label>
              <Input
                type="date"
                value={local.popup_end_date ?? ""}
                onChange={(e) => setLocal({ ...local, popup_end_date: e.target.value || null })}
              />
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Times are evaluated in the client's local timezone.
          </p>
        </div>
      )}
    </div>
  );
}