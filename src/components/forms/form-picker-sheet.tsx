import { Suspense, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, Check, Copy, Eye, Loader2, MoreHorizontal, Plus, Search, Send, Sparkles, Star } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import {
  categoryOf,
  libraryCategories,
  ownerLabel,
  pickerList,
  startTab,
  type LibraryForm,
  type PickerTab,
} from "@/lib/form-library";
import {
  FORM_LIBRARY_KEY,
  useFormFavorites,
  useFormSuggestions,
  useLibraryForms,
  useRecentSends,
  useToggleFavorite,
  useUpcomingMeets,
} from "@/lib/form-library.queries";
import { sendNativeFormFn } from "@/lib/native-forms.functions";
import { duplicateForm, getForm, listQuestions, upsertForm, type NfForm, type NfQuestion } from "@/lib/native-forms";
import { MEET_CHECKLIST_FORM_TYPE } from "@/lib/meet-checklist";
import { NativeFormPreviewDialog } from "@/components/forms/native-form-preview";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import type { ChatSendAttachment } from "@/components/chat-send-menu";

// The builder only loads when a coach makes or copies a form from the chat.
const FormEditorDialog = lazyWithRetry(() =>
  import("@/route-pages/_authenticated/admin/native-forms").then((m) => ({ default: m.FormEditorDialog })),
);
const NewFormFlow = lazyWithRetry(() => import("@/components/forms/new-form-flow").then((m) => ({ default: m.NewFormFlow })));

/**
 * Send Form, from the chat: the coach's library in a sheet, opening on what's
 * suggested for this client, else their favorites, else what they sent last.
 * Tap a form, Send: two taps. Preview, star, make a new form or a copy just
 * for this client, all without leaving the conversation, and whatever they
 * were typing stays in the message box.
 */
export function FormPickerSheet({
  open,
  onOpenChange,
  clientIds,
  clientName,
  onAttach,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientIds: string[];
  /** The client's first name (one client), for "Copy for Marc". */
  clientName?: string | null;
  onAttach: (att: ChatSendAttachment, body: string) => void | Promise<void>;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id ?? null;
  const single = clientIds.length === 1 ? clientIds[0] : null;
  const { data: forms = [], isLoading } = useLibraryForms(open);
  const { data: favorites = new Set<string>() } = useFormFavorites(open ? userId : null);
  const { data: recent = [] } = useRecentSends(open ? userId : null);
  const { data: suggestions = [] } = useFormSuggestions(open ? single : null, forms);
  const toggleFavorite = useToggleFavorite(userId);
  const send = useServerFn(sendNativeFormFn);

  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<PickerTab | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState<{ form: NfForm; questions: NfQuestion[] } | null>(null);
  const [editing, setEditing] = useState<NfForm | null>(null);
  const [creating, setCreating] = useState(false);
  const [meetPick, setMeetPick] = useState<{ name: string; date: string | null; weight_class: string | null } | null>(null);
  const [reminders, setReminders] = useState(true);

  const recentIds = useMemo(() => new Set(recent.map((r) => r.form_id)), [recent]);
  const suggestedIds = suggestions.map((s) => s.formId);
  const shownTab: PickerTab = tab ?? startTab({ suggested: suggestedIds.length, favorites: favorites.size, recent: recentIds.size });
  const list = useMemo(
    () => pickerList(forms, { tab: shownTab, query, favorites, recent, suggested: suggestions.map((s) => s.formId) }),
    [forms, shownTab, query, favorites, recent, suggestions],
  );
  const categories = useMemo(() => libraryCategories(forms), [forms]);
  const selected = forms.find((f) => f.id === selectedId) ?? null;
  const isMeet = selected?.form_type === MEET_CHECKLIST_FORM_TYPE;
  const { data: meets = [] } = useUpcomingMeets(single, open && isMeet);

  // A fresh open starts clean; the meet picks itself when there's one coming up.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setTab(null);
      setSelectedId(null);
      setNote("");
      setMeetPick(null);
      setReminders(true);
    }
  }, [open]);
  useEffect(() => {
    if (isMeet && !meetPick && meets.length) setMeetPick(meets[0]);
  }, [isMeet, meets, meetPick]);

  const tabs: Array<{ key: PickerTab; label: string; count?: number }> = [
    ...(suggestedIds.length ? [{ key: "suggested" as const, label: "Suggested", count: suggestedIds.length }] : []),
    { key: "favorites", label: "Favorites", count: favorites.size },
    { key: "recent", label: "Recent" },
    { key: "all", label: "All" },
    ...categories.map((c) => ({ key: `cat:${c}` as PickerTab, label: c })),
  ];

  async function openPreview(f: LibraryForm) {
    const [form, questions] = await Promise.all([getForm(f.id), listQuestions(f.id)]);
    if (form) setPreview({ form, questions });
  }

  async function copyForClient(f: LibraryForm) {
    try {
      const id = await duplicateForm(f.id);
      const title = clientName ? `${f.title} · ${clientName}` : `${f.title} (copy)`;
      await upsertForm({ id, title, category: f.category ?? undefined });
      await qc.invalidateQueries({ queryKey: FORM_LIBRARY_KEY });
      const form = await getForm(id);
      if (form) setEditing(form);
      setSelectedId(id);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't copy that form");
    }
  }

  async function handleSend() {
    if (!selected) return;
    setSending(true);
    try {
      const r = await send({
        data: {
          formId: selected.id,
          clientIds,
          meet: isMeet && meetPick ? meetPick : null,
          reminders: isMeet ? reminders : undefined,
        },
      });
      await onAttach(
        {
          kind: "form_request",
          type: "link",
          // Through the portal page so a Fillout link gets the client's identity (buildFilloutUrl).
          url: `/portal/check-ins/${selected.id}`,
          form_id: selected.id,
          assignment_client_ids: clientIds,
          request_title: selected.title,
          request_note: note.trim() || undefined,
        },
        note.trim() || `Shared a form: ${selected.title}`,
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["form-recent-sends", userId] }),
        qc.invalidateQueries({ queryKey: ["form-library-stats"] }),
        qc.invalidateQueries({ queryKey: ["nf-assignments", selected.id] }),
        qc.invalidateQueries({ queryKey: ["nf-forms-for-client"] }),
        qc.invalidateQueries({ queryKey: FORM_LIBRARY_KEY }),
      ]);
      onOpenChange(false);
      toast.success(r.freshCopies ? `${selected.title} sent · a fresh copy for this meet` : `${selected.title} sent`);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't send that form");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" hideCloseButton className="flex max-h-[92svh] flex-col gap-0 rounded-t-2xl p-0 sm:mx-auto sm:max-w-xl" data-form-picker>
          <SheetHeader className="flex-row items-center justify-between space-y-0 px-4 pb-2 pt-3 text-left">
            <SheetTitle className="text-[17px]">Send a form</SheetTitle>
            <Button type="button" variant="ghost" className="h-10 px-3 text-[15px]" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <SheetDescription className="sr-only">Pick a form from your library to send in this chat.</SheetDescription>
          </SheetHeader>
          <div className="px-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your forms" className="h-11 pl-9 text-[16px]" aria-label="Search your forms" />
            </div>
            {!query && (
              <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-2 [scrollbar-width:none]" role="tablist" aria-label="Form groups">
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={shownTab === t.key}
                    onClick={() => setTab(t.key)}
                    className={cn(
                      "h-9 shrink-0 rounded-full px-3.5 text-[14px] font-medium",
                      shownTab === t.key ? "bg-foreground text-background" : "bg-muted text-foreground",
                    )}
                  >
                    {t.key === "favorites" && <Star className="mr-1 inline h-3.5 w-3.5 -translate-y-px" />}
                    {t.key === "suggested" && <Sparkles className="mr-1 inline h-3.5 w-3.5 -translate-y-px" />}
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="min-h-[200px] flex-1 overflow-y-auto border-t border-border" data-form-picker-list>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-[15px] font-semibold active:bg-muted"
              data-form-picker-create
            >
              <span className="grid h-8 w-8 place-items-center rounded-full bg-muted"><Plus className="h-4 w-4" /></span>
              Create a new form
            </button>
            {isLoading && <p className="px-4 py-3 text-sm text-muted-foreground">Loading your forms…</p>}
            {!isLoading && list.length === 0 && (
              <p className="px-4 py-6 text-center text-[14px] text-muted-foreground">
                {query ? "No form matches that." : shownTab === "favorites" ? "Star a form to keep it here." : shownTab === "recent" ? "Forms you send show here." : "Nothing here yet."}
              </p>
            )}
            <ul>
              {list.map((f) => {
                const on = selectedId === f.id;
                const reason = suggestions.find((s) => s.formId === f.id)?.reason;
                const tag = ownerLabel(f, userId);
                return (
                  <li key={f.id} className={cn("flex items-center gap-1 border-t border-border/60 pr-2", on && "bg-muted ring-1 ring-inset ring-foreground/20")}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(on ? null : f.id)}
                      aria-pressed={on}
                      className="flex min-h-[60px] min-w-0 flex-1 flex-col justify-center px-4 py-2 text-left"
                      data-form-picker-row={f.id}
                    >
                      <span className="flex min-w-0 items-center gap-1.5 text-[15px] font-semibold">
                        {on && <Check className="h-4 w-4 shrink-0 text-success" strokeWidth={3} aria-label="Selected" />}
                        <span className="truncate">{f.title}</span>
                      </span>
                      <span className="truncate text-[13px] text-muted-foreground">
                        {[reason, categoryOf(f), tag, f.kind === "external" ? "External link" : null, !f.active ? "Draft" : null].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleFavorite(f.id, !favorites.has(f.id)).catch((e) => toast.error(e?.message ?? "Couldn't save"))}
                      aria-label={favorites.has(f.id) ? "Remove from favorites" : "Add to favorites"}
                      aria-pressed={favorites.has(f.id)}
                      className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground"
                    >
                      <Star className={cn("h-5 w-5", favorites.has(f.id) && "fill-warning text-warning")} />
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button type="button" aria-label="More" className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground">
                          <MoreHorizontal className="h-5 w-5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {f.kind !== "external" && (
                          <DropdownMenuItem onClick={() => void openPreview(f)}>
                            <Eye className="mr-2 h-4 w-4" /> Preview
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => void copyForClient(f)}>
                          <Copy className="mr-2 h-4 w-4" /> {clientName ? `Copy for ${clientName}` : "Make a copy"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                );
              })}
            </ul>
          </div>

          {selected && (
            <div className="space-y-3 border-t border-border bg-background px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3" data-form-picker-send>
              {isMeet && single && (
                <div className="space-y-2">
                  <p className="text-[13px] font-semibold">Which meet is it for?</p>
                  <div className="flex flex-wrap gap-2">
                    {meets.map((m) => {
                      const on = !!meetPick && meetPick.name === m.name && meetPick.date === m.date;
                      return (
                        <button
                          key={`${m.name}-${m.date}`}
                          type="button"
                          onClick={() => setMeetPick(on ? null : m)}
                          className={cn("min-h-[40px] rounded-full border px-3 text-[14px]", on ? "border-foreground bg-foreground text-background" : "border-border")}
                        >
                          {m.name}
                          {m.date ? ` · ${new Date(`${m.date}T00:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}` : ""}
                        </button>
                      );
                    })}
                    <MeetTyped value={meetPick} onChange={setMeetPick} />
                  </div>
                  <label className="flex items-center justify-between gap-3 text-[14px]">
                    <span className="inline-flex items-center gap-2">
                      <Bell className="h-4 w-4 text-muted-foreground" /> Remind them before the meet
                    </span>
                    <Switch checked={reminders} onCheckedChange={setReminders} aria-label="Remind them before the meet" />
                  </label>
                </div>
              )}
              <Textarea rows={1} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (optional)" className="min-h-[44px] text-[16px]" />
              <Button className="h-12 w-full text-[16px] font-semibold" onClick={handleSend} disabled={sending} data-form-picker-send-button>
                {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Send {selected.title.length > 32 ? "form" : selected.title}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {preview && <NativeFormPreviewDialog open onClose={() => setPreview(null)} form={preview.form} questions={preview.questions} />}
      {(editing || creating) && (
        <Suspense fallback={null}>
          {editing ? (
            <FormEditorDialog
              form={editing}
              open
              initialTab="questions"
              onClose={() => {
                setEditing(null);
                void qc.invalidateQueries({ queryKey: FORM_LIBRARY_KEY });
              }}
            />
          ) : (
            <NewFormFlow
              open
              onClose={() => setCreating(false)}
              onCreated={async (form) => {
                setCreating(false);
                await qc.invalidateQueries({ queryKey: FORM_LIBRARY_KEY });
                setTab("all");
                setSelectedId(form.id);
                setEditing(form);
              }}
            />
          )}
        </Suspense>
      )}
    </>
  );
}

/** "Other meet": a name and a date typed in, for one that isn't on file. */
function MeetTyped({
  value,
  onChange,
}: {
  value: { name: string; date: string | null; weight_class: string | null } | null;
  onChange: (v: { name: string; date: string | null; weight_class: string | null } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="min-h-[40px] rounded-full border border-dashed border-border px-3 text-[14px] text-muted-foreground">
        Other meet
      </button>
    );
  }
  return (
    <div className="flex w-full gap-2">
      <Input
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          onChange(e.target.value.trim() ? { name: e.target.value.trim(), date: date || null, weight_class: value?.weight_class ?? null } : null);
        }}
        placeholder="Meet name"
        className="h-10 flex-1 text-[16px]"
        autoFocus
      />
      <Input
        type="date"
        value={date}
        onChange={(e) => {
          setDate(e.target.value);
          if (name.trim()) onChange({ name: name.trim(), date: e.target.value || null, weight_class: value?.weight_class ?? null });
        }}
        className="h-10 w-[150px] text-[16px]"
        aria-label="Meet date"
      />
    </div>
  );
}

export type { NfForm };
