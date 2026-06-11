import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, MoreHorizontal, Trash2, ListChecks, Settings2, StickyNote, RotateCcw, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  QUADRANTS, fetchTasks, fetchCoachesLite, createTask, toggleTaskDone,
  updateTask, deleteTask, type TaskRow, type TaskQuadrant, type TaskScope,
} from "@/lib/tasks";
import { cn } from "@/lib/utils";

// ---------- Quadrant customization (color + labels), persisted to localStorage ----------
type QuadStyle = { color: string; title: string; subtitle: string };
const DEFAULT_STYLES: Record<TaskQuadrant, QuadStyle> = {
  do:        { color: "#22c55e", title: "Do First",  subtitle: "Urgent · Important" },
  schedule:  { color: "#3b82f6", title: "Schedule",  subtitle: "Important · Not Urgent" },
  delegate:  { color: "#eab308", title: "Delegate",  subtitle: "Urgent · Not Important" },
  eliminate: { color: "#ef4444", title: "Eliminate", subtitle: "Not Urgent · Not Important" },
};

function useQuadrantStyles(storageKey: string) {
  const [styles, setStyles] = useState<Record<TaskQuadrant, QuadStyle>>(DEFAULT_STYLES);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setStyles({ ...DEFAULT_STYLES, ...JSON.parse(raw) });
    } catch {}
  }, [storageKey]);
  const save = (next: Record<TaskQuadrant, QuadStyle>) => {
    setStyles(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {}
  };
  const update = (key: TaskQuadrant, patch: Partial<QuadStyle>) => {
    save({ ...styles, [key]: { ...styles[key], ...patch } });
  };
  const reset = (key: TaskQuadrant) => {
    save({ ...styles, [key]: DEFAULT_STYLES[key] });
  };
  return { styles, update, reset };
}

function tintStyle(color: string) {
  return { backgroundColor: `${color}1A`, borderColor: `${color}80` } as React.CSSProperties;
}

// ---------- Quick Notes (localStorage, autosave) ----------
type Note = { id: string; title: string; body: string; updatedAt: number };

function useNotes(storageKey: string) {
  const [notes, setNotes] = useState<Note[]>([]);
  const loadedRef = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setNotes(JSON.parse(raw));
    } catch {}
    loadedRef.current = true;
  }, [storageKey]);
  useEffect(() => {
    if (!loadedRef.current) return;
    const t = setTimeout(() => {
      try { localStorage.setItem(storageKey, JSON.stringify(notes)); } catch {}
    }, 250);
    return () => clearTimeout(t);
  }, [notes, storageKey]);
  return [notes, setNotes] as const;
}

export interface TasksPageProps {
  title?: string;
  subtitle?: string;
  storagePrefix?: string;
  scope?: TaskScope;
}

export function TasksPage({
  title = "Task Manager",
  subtitle = "Collaborate on what needs to get done.",
  storagePrefix = "jf",
  scope = "admin",
}: TasksPageProps = {}) {
  const qc = useQueryClient();
  const { data: tasks = [] } = useQuery({ queryKey: ["tasks", scope], queryFn: () => fetchTasks(scope) });
  const { data: coaches = [] } = useQuery({ queryKey: ["coaches-lite"], queryFn: fetchCoachesLite });
  const { styles: quadStyles, update: updateQuadStyle, reset: resetQuadStyle } =
    useQuadrantStyles(`${storagePrefix}-quadrant-styles`);

  useEffect(() => {
    const ch = supabase.channel(`${storagePrefix}-tasks-rt`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `scope=eq.${scope}` }, () => {
        qc.invalidateQueries({ queryKey: ["tasks", scope] });
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc, storagePrefix, scope]);

  const [newTitle, setNewTitle] = useState("");
  const [newQuadrant, setNewQuadrant] = useState<TaskQuadrant>("do");

  const open = useMemo(() => tasks.filter((t) => t.status === "open"), [tasks]);
  const done = useMemo(() => tasks.filter((t) => t.status === "done"), [tasks]);
  const byQuadrant = useMemo(() => {
    const m: Record<TaskQuadrant, TaskRow[]> = { do: [], schedule: [], delegate: [], eliminate: [] };
    for (const t of open) m[t.quadrant].push(t);
    return m;
  }, [open]);

  const coachName = (id: string | null) => coaches.find((c) => c.id === id)?.full_name ?? null;

  async function handleAdd() {
    const title = newTitle.trim();
    if (!title) return;
    setNewTitle("");
    await createTask({ title, quadrant: newQuadrant, scope });
    qc.invalidateQueries({ queryKey: ["tasks", scope] });
  }

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <div className="space-y-5 p-4 pb-32 md:p-6 md:pb-8">
        <Card className="border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <ListChecks className="h-4 w-4 text-primary" />
            <span className="text-sm font-bold">Add a task</span>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
              placeholder="What needs to get done?"
              className="flex-1"
            />
            <Select value={newQuadrant} onValueChange={(v) => setNewQuadrant(v as TaskQuadrant)}>
              <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {QUADRANTS.map((q) => (
                  <SelectItem key={q.key} value={q.key}>{quadStyles[q.key].title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleAdd}><Plus className="mr-1 h-4 w-4" />Add</Button>
          </div>
        </Card>

        <QuickNotesPanel storageKey={`${storagePrefix}-task-notes`} />

        <Card className="border-border bg-card p-4 md:p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Checklist</h2>
            <Badge variant="outline">{open.length} open</Badge>
          </div>
          {open.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Inbox zero. Add a task above to get started.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {open.map((t) => (
                <TaskListRow key={t.id} task={t} coaches={coaches} coachName={coachName} quadStyles={quadStyles} />
              ))}
            </ul>
          )}
          {done.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs font-semibold text-muted-foreground hover:text-foreground">
                Completed ({done.length})
              </summary>
              <ul className="mt-2 divide-y divide-border">
                {done.slice(0, 50).map((t) => (
                  <TaskListRow key={t.id} task={t} coaches={coaches} coachName={coachName} quadStyles={quadStyles} />
                ))}
              </ul>
            </details>
          )}
        </Card>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Eisenhower Matrix</h2>
            <span className="text-[11px] text-muted-foreground">Click the gear on a quadrant to change color & labels.</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {QUADRANTS.map((q) => (
              <Card
                key={q.key}
                className="border p-4 transition-shadow hover:shadow-md"
                style={tintStyle(quadStyles[q.key].color)}
              >
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-black tracking-tight" style={{ color: quadStyles[q.key].color }}>
                      {quadStyles[q.key].title}
                    </div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      {quadStyles[q.key].subtitle}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge variant="outline" style={{ borderColor: `${quadStyles[q.key].color}80`, color: quadStyles[q.key].color }}>
                      {byQuadrant[q.key].length}
                    </Badge>
                    <QuadrantCustomizer
                      style={quadStyles[q.key]}
                      onChange={(p) => updateQuadStyle(q.key, p)}
                      onReset={() => resetQuadStyle(q.key)}
                    />
                  </div>
                </div>
                {byQuadrant[q.key].length === 0 ? (
                  <div className="rounded-md border border-dashed border-border/70 p-4 text-center text-xs text-muted-foreground">
                    Nothing here.
                  </div>
                ) : (
                  <ul className="space-y-1.5">
                    {byQuadrant[q.key].map((t) => (
                      <li key={t.id} className="flex items-start gap-2 rounded-md border border-border/60 bg-card/70 p-2.5">
                        <Checkbox checked={false} onCheckedChange={async (v) => {
                          if (v) await toggleTaskDone(t.id, true);
                        }} className="mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium leading-tight">{t.title}</div>
                          {coachName(t.assigned_to) && (
                            <div className="mt-0.5 text-[10px] text-muted-foreground">→ {coachName(t.assigned_to)}</div>
                          )}
                        </div>
                        <TaskRowMenu task={t} coaches={coaches} quadStyles={quadStyles} />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function TaskListRow({ task, coaches, coachName, quadStyles }: { task: TaskRow; coaches: { id: string; full_name: string | null }[]; coachName: (id: string | null) => string | null; quadStyles: Record<TaskQuadrant, QuadStyle> }) {
  const isDone = task.status === "done";
  const qs = quadStyles[task.quadrant];
  return (
    <li className="flex items-start gap-3 py-2.5">
      <Checkbox checked={isDone} onCheckedChange={(v) => toggleTaskDone(task.id, !!v)} className="mt-1" />
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm font-medium", isDone && "line-through text-muted-foreground")}>{task.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          <Badge variant="outline" className="text-[9px]" style={{ borderColor: `${qs.color}80`, color: qs.color }}>
            {qs.title}
          </Badge>
          {coachName(task.assigned_to) && <span>→ {coachName(task.assigned_to)}</span>}
        </div>
      </div>
      <TaskRowMenu task={task} coaches={coaches} quadStyles={quadStyles} />
    </li>
  );
}

function TaskRowMenu({ task, coaches, quadStyles }: { task: TaskRow; coaches: { id: string; full_name: string | null }[]; quadStyles: Record<TaskQuadrant, QuadStyle> }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"><MoreHorizontal className="h-4 w-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1 text-[10px] uppercase tracking-widest text-muted-foreground">Move to</div>
        {QUADRANTS.map((q) => (
          <DropdownMenuItem key={q.key} disabled={q.key === task.quadrant} onClick={() => updateTask(task.id, { quadrant: q.key })}>
            <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: quadStyles[q.key].color }} />
            {quadStyles[q.key].title}
          </DropdownMenuItem>
        ))}
        <div className="mt-1 px-2 py-1 text-[10px] uppercase tracking-widest text-muted-foreground">Assign to</div>
        <DropdownMenuItem onClick={() => updateTask(task.id, { assigned_to: null })}>Unassigned</DropdownMenuItem>
        {coaches.map((c) => (
          <DropdownMenuItem key={c.id} onClick={() => updateTask(task.id, { assigned_to: c.id })}>
            {c.full_name ?? "—"}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem className="text-destructive" onClick={() => deleteTask(task.id)}>
          <Trash2 className="mr-2 h-4 w-4" />Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function QuadrantCustomizer({ style, onChange, onReset }: { style: QuadStyle; onChange: (p: Partial<QuadStyle>) => void; onReset: () => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Customize quadrant">
          <Settings2 className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Color</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={style.color}
              onChange={(e) => onChange({ color: e.target.value })}
              className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent"
              aria-label="Pick color"
            />
            <Input
              value={style.color}
              onChange={(e) => onChange({ color: e.target.value })}
              className="h-9 flex-1 font-mono text-xs"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Title</Label>
          <Input value={style.title} onChange={(e) => onChange({ title: e.target.value })} className="h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Subtitle</Label>
          <Input value={style.subtitle} onChange={(e) => onChange({ subtitle: e.target.value })} className="h-9" />
        </div>
        <Button variant="ghost" size="sm" onClick={onReset} className="w-full">
          <RotateCcw className="mr-1 h-3.5 w-3.5" />Reset to default
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function QuickNotesPanel({ storageKey }: { storageKey: string }) {
  const [notes, setNotes] = useNotes(storageKey);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const addNote = useCallback(() => {
    const n: Note = {
      id: (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      title: "",
      body: "",
      updatedAt: Date.now(),
    };
    setNotes((arr) => [n, ...arr]);
  }, [setNotes]);

  const updateNote = (id: string, patch: Partial<Note>) => {
    setNotes((arr) => arr.map((n) => n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n));
  };
  const removeNote = (id: string) => {
    setNotes((arr) => arr.filter((n) => n.id !== id));
    setSelected((s) => { const x = new Set(s); x.delete(id); return x; });
  };
  const toggleSelect = (id: string, on: boolean) => {
    setSelected((s) => { const x = new Set(s); if (on) x.add(id); else x.delete(id); return x; });
  };
  const allSelected = notes.length > 0 && selected.size === notes.length;
  const someSelected = selected.size > 0 && !allSelected;
  const toggleAll = (on: boolean) => {
    setSelected(on ? new Set(notes.map((n) => n.id)) : new Set());
  };
  const deleteSelected = () => {
    setNotes((arr) => arr.filter((n) => !selected.has(n.id)));
    setSelected(new Set());
  };

  return (
    <Card className="border-border bg-card p-4 md:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StickyNote className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-bold">Quick Notes</h2>
          <Badge variant="outline" className="text-[10px]">{notes.length}</Badge>
        </div>
        <div className="flex items-center gap-2">
          {notes.length > 0 && (
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={(v) => toggleAll(!!v)}
              />
              Select all
            </label>
          )}
          {selected.size > 0 && (
            <Button variant="destructive" size="sm" onClick={deleteSelected}>
              <Trash2 className="mr-1 h-3.5 w-3.5" />Delete ({selected.size})
            </Button>
          )}
          <Button size="sm" onClick={addNote}><Plus className="mr-1 h-3.5 w-3.5" />Add note</Button>
        </div>
      </div>

      {notes.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No notes yet. Hit "Add note" to jot something down — it auto-saves as you type.
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {notes.map((n) => (
            <NoteCard
              key={n.id}
              note={n}
              selected={selected.has(n.id)}
              onSelect={(on) => toggleSelect(n.id, on)}
              onChange={(p) => updateNote(n.id, p)}
              onRemove={() => removeNote(n.id)}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function NoteCard({ note, selected, onSelect, onChange, onRemove }: {
  note: Note;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onChange: (p: Partial<Note>) => void;
  onRemove: () => void;
}) {
  const [savedFlash, setSavedFlash] = useState(false);
  const flashRef = useRef<number | null>(null);
  const flash = () => {
    setSavedFlash(true);
    if (flashRef.current) window.clearTimeout(flashRef.current);
    flashRef.current = window.setTimeout(() => setSavedFlash(false), 700);
  };
  return (
    <div className={cn("flex flex-col gap-1.5 rounded-md border bg-card/70 p-2.5 transition-colors", selected ? "border-primary/60 bg-primary/5" : "border-border/60")}>
      <div className="flex items-center gap-2">
        <Checkbox checked={selected} onCheckedChange={(v) => onSelect(!!v)} />
        <Input
          value={note.title}
          onChange={(e) => { onChange({ title: e.target.value }); flash(); }}
          placeholder="Title (optional)"
          className="h-7 flex-1 border-0 bg-transparent px-0 text-sm font-bold focus-visible:ring-0"
        />
          {savedFlash && <span className="text-[10px] font-semibold text-emerald-500">saved</span>}
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onRemove} aria-label="Delete note">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <Textarea
        value={note.body}
        onChange={(e) => { onChange({ body: e.target.value }); flash(); }}
        placeholder="Type your note…"
        rows={3}
        className="resize-none border-0 bg-transparent px-0 text-sm focus-visible:ring-0"
      />
    </div>
  );
}