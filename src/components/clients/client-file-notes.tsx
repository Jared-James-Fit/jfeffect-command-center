import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict, format, parseISO } from "date-fns";
import {
  Archive, ChevronDown, Copy, MoreHorizontal, Pencil, Pin, PinOff, Plus, RefreshCw, RotateCcw, Search, StickyNote,
} from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  addClientFileNote, clientFileNotesKey, isFresh, listClientFileNotes, setClientFileNoteArchived,
  sortActive, sortArchived, updateClientFileNote, type ClientFileNote,
} from "@/lib/client-file-notes";
import { cn } from "@/lib/utils";

const ago = (iso: string) => {
  try { return formatDistanceToNowStrict(parseISO(iso), { addSuffix: true }); } catch { return ""; }
};
const heading = (n: Pick<ClientFileNote, "title" | "body">) =>
  n.title.trim() || n.body.split("\n").find((l) => l.trim())?.trim() || "Untitled note";
const bodyWithoutHeading = (n: Pick<ClientFileNote, "title" | "body">) => {
  if (n.title.trim()) return n.body.trim();
  const lines = n.body.split("\n");
  const first = lines.findIndex((l) => l.trim());
  return lines.slice(first + 1).join("\n").trim();
};

/**
 * Staff notes kept on the client's file. Newest first (pinned on top); anything archived,
 * including notes whose Quick Note was deleted, stays in the Archive below.
 */
export function ClientFileNotes({ clientId, className }: { clientId: string; className?: string }) {
  const qc = useQueryClient();
  const key = clientFileNotesKey(clientId);
  const { data: notes = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: () => listClientFileNotes(clientId),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState({ title: "", body: "" });
  const [saving, setSaving] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [q, setQ] = useState("");

  const active = useMemo(() => sortActive(notes.filter((n) => !n.archived_at)), [notes]);
  const archived = useMemo(() => sortArchived(notes.filter((n) => n.archived_at)), [notes]);
  const match = (n: ClientFileNote) => !q.trim() || `${n.title}\n${n.body}`.toLowerCase().includes(q.trim().toLowerCase());
  const shownActive = active.filter(match);
  const shownArchived = archived.filter(match);

  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const patchLocal = (id: string, patch: Partial<ClientFileNote>) =>
    qc.setQueryData<ClientFileNote[]>(key, (old) => (old ?? []).map((n) => (n.id === id ? { ...n, ...patch } : n)));

  const save = async () => {
    if (!draft.title.trim() && !draft.body.trim()) return;
    setSaving(true);
    try {
      const row = await addClientFileNote(clientId, draft.title, draft.body);
      qc.setQueryData<ClientFileNote[]>(key, (old) => [row, ...(old ?? [])]);
      setDraft({ title: "", body: "" });
      setComposing(false);
      toast.success("Saved to the client file");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save the note");
    } finally {
      setSaving(false);
    }
  };

  const archive = async (n: ClientFileNote, on: boolean) => {
    const now = new Date().toISOString();
    patchLocal(n.id, on ? { archived_at: now, archive_reason: "manual", pinned: false } : { archived_at: null, archive_reason: null });
    try {
      await setClientFileNoteArchived(n.id, on);
      if (on) toast("Moved to Archive", { action: { label: "Undo", onClick: () => void archive({ ...n, archived_at: now }, false) } });
      else toast.success("Restored");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't update the note");
    } finally {
      void refresh();
    }
  };

  const pin = async (n: ClientFileNote) => {
    patchLocal(n.id, { pinned: !n.pinned });
    try { await updateClientFileNote(n.id, { pinned: !n.pinned }); }
    catch (e: any) { toast.error(e?.message ?? "Couldn't update the note"); }
    finally { void refresh(); }
  };

  return (
    <Card className={cn("space-y-3 border-border bg-card p-4 md:p-6", className)}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <StickyNote className="h-3.5 w-3.5" /> Client file
            {active.length > 0 && <span className="tabular-nums text-muted-foreground/70">{active.length}</span>}
          </h3>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Staff-only notes. Quick Notes saved to this client sync here; deleted ones stay in the Archive.
          </p>
        </div>
        {!composing && (
          <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1 text-xs" onClick={() => setComposing(true)}>
            <Plus className="h-3.5 w-3.5" /> Add note
          </Button>
        )}
      </div>

      {composing && (
        <div className="space-y-2 rounded-xl border border-border bg-background/50 p-3">
          <input
            autoFocus
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder="Title (optional)"
            className="w-full bg-transparent text-sm font-semibold outline-none placeholder:text-muted-foreground/60"
          />
          <Textarea
            rows={3}
            value={draft.body}
            onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
            placeholder="What should the team remember about this client?"
            className="text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setComposing(false); setDraft({ title: "", body: "" }); }}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving || (!draft.title.trim() && !draft.body.trim())}>Save</Button>
          </div>
        </div>
      )}

      {notes.length > 5 && (
        <label className="flex items-center gap-2 rounded-lg border border-border bg-background/40 px-2.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search notes"
            className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />
        </label>
      )}

      {isLoading ? (
        <div className="h-14 animate-pulse rounded-lg bg-secondary/40" />
      ) : shownActive.length === 0 ? (
        !composing && (
          <p className="rounded-lg bg-secondary/30 px-3 py-3 text-xs text-muted-foreground">
            {q.trim() ? "No notes match." : "No notes yet. Add one here, or save a Quick Note to this client from Tasks."}
          </p>
        )
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl ring-1 ring-border">
          {shownActive.map((n) => (
            <NoteRow key={n.id} note={n} onPin={() => pin(n)} onArchive={() => archive(n, true)} onSaved={(p) => { patchLocal(n.id, p); void refresh(); }} />
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowArchive((v) => !v)}
            aria-expanded={showArchive}
            className="flex items-center gap-1.5 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !showArchive && "-rotate-90")} />
            <Archive className="h-3.5 w-3.5" /> Archive <span className="tabular-nums">{archived.length}</span>
          </button>
          {showArchive && (
            <ul className="mt-1 divide-y divide-border overflow-hidden rounded-xl bg-secondary/20 ring-1 ring-border">
              {shownArchived.map((n) => (
                <li key={n.id} className="flex items-start gap-2 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-muted-foreground">{heading(n)}</div>
                    {bodyWithoutHeading(n) && <p className="line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground/80">{bodyWithoutHeading(n)}</p>}
                    <div className="mt-1 text-[10px] text-muted-foreground/70">
                      {n.archive_reason === "quick_note_removed" ? "Removed from Quick Notes" : "Archived"}
                      {n.archived_at ? ` · ${format(parseISO(n.archived_at), "d MMM yyyy")}` : ""}
                      {` · written ${format(parseISO(n.created_at), "d MMM yyyy")}`}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" className="h-8 shrink-0 px-2 text-xs text-primary hover:text-primary" onClick={() => archive(n, false)}>
                    <RotateCcw className="mr-1 h-3.5 w-3.5" /> Restore
                  </Button>
                </li>
              ))}
              {shownArchived.length === 0 && <li className="px-3 py-2.5 text-xs text-muted-foreground">No archived notes match.</li>}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

function NoteRow({
  note: n, onPin, onArchive, onSaved,
}: {
  note: ClientFileNote;
  onPin: () => void;
  onArchive: () => void;
  onSaved: (patch: Partial<ClientFileNote>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: n.title, body: n.body });
  const [busy, setBusy] = useState(false);
  const rest = bodyWithoutHeading(n);
  const long = rest.length > 220 || rest.split("\n").length > 4;

  const save = async () => {
    setBusy(true);
    try {
      await updateClientFileNote(n.id, { title: draft.title.trim(), body: draft.body });
      onSaved({ title: draft.title.trim(), body: draft.body, updated_at: new Date().toISOString() });
      setEditing(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save the note");
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <li className="space-y-2 bg-background/50 p-3">
        <input
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          placeholder="Title (optional)"
          className="w-full bg-transparent text-sm font-semibold outline-none placeholder:text-muted-foreground/60"
        />
        <Textarea rows={4} value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} className="text-sm" />
        {n.source === "quick_note" && n.quick_note_id && (
          <p className="text-[10px] text-muted-foreground">Synced: the author's Quick Note picks up this edit.</p>
        )}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft({ title: n.title, body: n.body }); }}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy}>Save</Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-start gap-2 px-3 py-2.5">
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => long && setExpanded((v) => !v)}>
        <div className="flex items-center gap-1.5">
          {n.pinned && <Pin className="h-3 w-3 shrink-0 text-primary" aria-label="Pinned" />}
          <span className="truncate text-sm font-semibold">{heading(n)}</span>
          {isFresh(n.created_at) && <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-primary">New</span>}
        </div>
        {rest && <p className={cn("mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground", !expanded && "line-clamp-3")}>{rest}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground/70">
          <span>{n.updated_at !== n.created_at ? `Updated ${ago(n.updated_at)}` : ago(n.created_at)}</span>
          {n.source === "quick_note" && (
            <span className="inline-flex items-center gap-0.5">
              <RefreshCw className="h-2.5 w-2.5" /> {n.quick_note_id ? "Synced with Quick Notes" : "From Quick Notes"}
            </span>
          )}
          {long && <span className="font-semibold text-primary">{expanded ? "Less" : "More"}</span>}
        </div>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground" aria-label="Note actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => { setDraft({ title: n.title, body: n.body }); setEditing(true); }}>
            <Pencil className="mr-2 h-4 w-4" /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onPin}>
            {n.pinned ? <PinOff className="mr-2 h-4 w-4" /> : <Pin className="mr-2 h-4 w-4" />}
            {n.pinned ? "Unpin" : "Pin to top"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={async () => {
              try { await navigator.clipboard.writeText([n.title, n.body].filter((s) => s.trim()).join("\n\n")); toast.success("Copied ✓"); }
              catch { toast.error("Couldn't copy"); }
            }}
          >
            <Copy className="mr-2 h-4 w-4" /> Copy
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onArchive}>
            <Archive className="mr-2 h-4 w-4" /> Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
