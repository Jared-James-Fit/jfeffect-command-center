import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { StickyNote, Pin, PinOff, Archive, Trash2, Plus, MoreHorizontal, ListChecks, FileText, FileEdit, Check } from "lucide-react";
import {
  fetchQuickNotes, createQuickNote, updateQuickNote, deleteQuickNote,
  convertNoteToTask, convertNoteToDraft, convertNoteToContentIdea,
  importLocalQuickNotesOnce, type QuickNoteRow,
} from "@/lib/media-quick-notes";
import { toast } from "sonner";

/** DB-backed Quick Notes for the Media Manager. Autosaves on blur and 600ms debounce. */
export function QuickNotesDBPanel({ legacyStorageKey = "media-task-notes" }: { legacyStorageKey?: string }) {
  const qc = useQueryClient();
  const { data: notes = [], isLoading } = useQuery({
    queryKey: ["media-quick-notes"],
    queryFn: () => fetchQuickNotes({ includeArchived: false }),
  });

  // One-time import of any local notes.
  useEffect(() => {
    (async () => {
      const n = await importLocalQuickNotesOnce(legacyStorageKey);
      if (n > 0) {
        toast.success(`Imported ${n} note${n === 1 ? "" : "s"} from this device`);
        qc.invalidateQueries({ queryKey: ["media-quick-notes"] });
      }
    })();
  }, [legacyStorageKey, qc]);

  async function add() {
    await createQuickNote({});
    qc.invalidateQueries({ queryKey: ["media-quick-notes"] });
  }

  return (
    <Card className="border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StickyNote className="h-4 w-4 text-primary" />
          <span className="text-sm font-bold">Quick Notes</span>
          <Badge variant="outline">{notes.length}</Badge>
        </div>
        <Button size="sm" onClick={add}><Plus className="mr-1 h-4 w-4" />Add note</Button>
      </div>
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : notes.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No notes yet. Capture ideas, then convert to a task, draft, or content idea.
        </div>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {notes.map((n) => <NoteCard key={n.id} note={n} />)}
        </ul>
      )}
    </Card>
  );
}

function NoteCard({ note }: { note: QuickNoteRow }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setTitle(note.title); setBody(note.body); }, [note.id, note.title, note.body]);

  function schedule() {
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(async () => {
      try {
        await updateQuickNote(note.id, { title, body });
        setSavedAt(Date.now());
      } catch (e: any) { toast.error(e?.message ?? "Save failed"); }
    }, 600);
  }

  async function togglePin() {
    await updateQuickNote(note.id, { pinned: !note.pinned });
    qc.invalidateQueries({ queryKey: ["media-quick-notes"] });
  }
  async function archive() {
    await updateQuickNote(note.id, { archived: true });
    qc.invalidateQueries({ queryKey: ["media-quick-notes"] });
    toast.success("Archived");
  }
  async function del() {
    if (!confirm("Delete this note?")) return;
    await deleteQuickNote(note.id);
    qc.invalidateQueries({ queryKey: ["media-quick-notes"] });
  }
  async function toTask() {
    await convertNoteToTask(note);
    qc.invalidateQueries({ queryKey: ["media-quick-notes"] });
    qc.invalidateQueries({ queryKey: ["media-tasks"] });
    toast.success("Converted to task");
  }
  async function toDraft() {
    await convertNoteToDraft(note);
    qc.invalidateQueries({ queryKey: ["media-quick-notes"] });
    toast.success("Converted to draft");
  }
  async function toIdea() {
    await convertNoteToContentIdea(note);
    qc.invalidateQueries({ queryKey: ["media-quick-notes"] });
    toast.success("Converted to content idea");
  }

  return (
    <li className="rounded-md border border-border bg-card/60 p-3">
      <div className="flex items-start gap-2">
        <Input
          value={title}
          onChange={(e) => { setTitle(e.target.value); schedule(); }}
          placeholder="Note title…"
          className="h-8 flex-1 border-0 bg-transparent px-0 text-sm font-semibold focus-visible:ring-0"
        />
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={togglePin} title={note.pinned ? "Unpin" : "Pin"}>
          {note.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-3.5 w-3.5" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={toTask}><ListChecks className="mr-2 h-4 w-4" />Convert to Task</DropdownMenuItem>
            <DropdownMenuItem onClick={toDraft}><FileEdit className="mr-2 h-4 w-4" />Convert to Draft</DropdownMenuItem>
            <DropdownMenuItem onClick={toIdea}><FileText className="mr-2 h-4 w-4" />Convert to Content Idea</DropdownMenuItem>
            <DropdownMenuItem onClick={archive}><Archive className="mr-2 h-4 w-4" />Archive</DropdownMenuItem>
            <DropdownMenuItem onClick={del} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Textarea
        value={body}
        onChange={(e) => { setBody(e.target.value); schedule(); }}
        placeholder="Write a quick note…"
        rows={3}
        className="mt-1 resize-none border-0 bg-transparent px-0 text-sm focus-visible:ring-0"
      />
      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{note.pinned && "Pinned · "}{new Date(note.updated_at).toLocaleString()}</span>
        {savedAt && <span className="flex items-center gap-1"><Check className="h-3 w-3" />Saved</span>}
      </div>
    </li>
  );
}