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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  Plus, MoreHorizontal, Trash2, Settings2, StickyNote, RotateCcw, X, Users, Pencil, Check,
  Search, ListChecks, LayoutGrid, ChevronRight, ChevronDown, CheckCheck, ArrowRightLeft, Copy, ListTodo,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  QUADRANTS, fetchTasks, createTask, toggleTaskDone,
  updateTask, deleteTask, bulkSetTaskStatus, bulkMoveTasks, bulkAssignTasks, bulkDeleteTasksByIds,
  type TaskRow, type TaskQuadrant, type TaskScope,
} from "@/lib/tasks";
import { useIsMobile } from "@/hooks/use-mobile";
import { TaskSwipeRow } from "@/components/tasks/task-swipe-row";
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
  const update = (key: TaskQuadrant, patch: Partial<QuadStyle>) => save({ ...styles, [key]: { ...styles[key], ...patch } });
  const reset = (key: TaskQuadrant) => save({ ...styles, [key]: DEFAULT_STYLES[key] });
  return { styles, update, reset };
}

function tintStyle(color: string) {
  return { backgroundColor: `${color}14`, borderColor: `${color}66` } as React.CSSProperties;
}

// ---------- Custom Assignees (localStorage) ----------
type Assignee = { id: string; name: string };

function useAssignees(storageKey: string) {
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const loadedRef = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setAssignees(JSON.parse(raw));
    } catch {}
    loadedRef.current = true;
  }, [storageKey]);
  useEffect(() => {
    if (!loadedRef.current) return;
    try { localStorage.setItem(storageKey, JSON.stringify(assignees)); } catch {}
  }, [assignees, storageKey]);
  return [assignees, setAssignees] as const;
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

const newId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

type FilterKey = "all" | "unassigned" | "assigned" | TaskQuadrant;

export interface TasksPageProps {
  title?: string;
  subtitle?: string;
  storagePrefix?: string;
  scope?: TaskScope;
}

export function TasksPage({
  title = "Task Manager",
  subtitle = "Capture fast. Clear fast.",
  storagePrefix = "jf",
  scope = "admin",
}: TasksPageProps = {}) {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const queryKey = useMemo(() => ["tasks", scope] as const, [scope]);
  const { data: tasks = [] } = useQuery({ queryKey, queryFn: () => fetchTasks(scope) });
  const [assignees, setAssignees] = useAssignees(`${storagePrefix}-task-assignees`);
  const [assigneesOpen, setAssigneesOpen] = useState(false);
  const { styles: quadStyles, update: updateQuadStyle, reset: resetQuadStyle } =
    useQuadrantStyles(`${storagePrefix}-quadrant-styles`);

  // realtime — unchanged canonical source of truth
  useEffect(() => {
    const ch = supabase.channel(`${storagePrefix}-tasks-rt`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `scope=eq.${scope}` }, () => {
        qc.invalidateQueries({ queryKey: ["tasks", scope] });
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc, storagePrefix, scope]);

  // ---- local cache helpers (optimistic) ----
  const patchLocal = useCallback((fn: (rows: TaskRow[]) => TaskRow[]) => {
    qc.setQueryData(queryKey, (prev: TaskRow[] | undefined) => fn(prev ?? []));
  }, [qc, queryKey]);
  const refresh = useCallback(() => { qc.invalidateQueries({ queryKey: ["tasks", scope] }); }, [qc, scope]);

  // ---- view / filter state ----
  const [view, setView] = useState<"list" | "matrix">("list");
  useEffect(() => {
    try {
      const v = localStorage.getItem(`${storagePrefix}-tasks-view`);
      if (v === "matrix" || v === "list") setView(v);
    } catch {}
  }, [storagePrefix]);
  const switchView = (v: "list" | "matrix") => {
    setView(v);
    try { localStorage.setItem(`${storagePrefix}-tasks-view`, v); } catch {}
  };

  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);

  // ---- quick add ----
  const [newTitle, setNewTitle] = useState("");
  const addRef = useRef<HTMLInputElement | null>(null);
  const [defaultQuadrant, setDefaultQuadrant] = useState<TaskQuadrant>("do");
  useEffect(() => {
    try {
      const q = localStorage.getItem(`${storagePrefix}-tasks-default-quadrant`) as TaskQuadrant | null;
      if (q && ["do", "schedule", "delegate", "eliminate"].includes(q)) setDefaultQuadrant(q);
    } catch {}
  }, [storagePrefix]);
  const pickDefaultQuadrant = (q: TaskQuadrant) => {
    setDefaultQuadrant(q);
    try { localStorage.setItem(`${storagePrefix}-tasks-default-quadrant`, q); } catch {}
  };

  const quickAdd = useCallback(async (raw: string, quadrant: TaskQuadrant) => {
    const t = raw.trim();
    if (!t) return;
    setNewTitle("");
    addRef.current?.focus();
    const temp: TaskRow = {
      id: `temp-${newId()}`, title: t, notes: null, quadrant, status: "open", priority: 0,
      due_at: null, created_by: null, assigned_to: null, assignee_name: null,
      completed_at: null, completed_by: null, position: 0, scope,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    patchLocal((rows) => [temp, ...rows]);
    try {
      await createTask({ title: t, quadrant, scope });
    } catch (e: any) {
      patchLocal((rows) => rows.filter((r) => r.id !== temp.id));
      toast.error(e?.message ?? "Could not add task");
      return;
    }
    refresh();
  }, [patchLocal, refresh, scope]);

  // ---- selection ----
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const clearSelection = () => setSelected(new Set());
  const exitSelect = () => { setSelectMode(false); clearSelection(); };
  const toggleSelected = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // ---- derived collections ----
  const openTasks = useMemo(() => tasks.filter((t) => t.status === "open"), [tasks]);
  const doneTasks = useMemo(() => tasks.filter((t) => t.status === "done"), [tasks]);

  const matchesSearch = useCallback((t: TaskRow) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [t.title, t.notes ?? "", t.assignee_name ?? ""].join(" ").toLowerCase().includes(q);
  }, [search]);

  const visibleOpen = useMemo(() => openTasks.filter((t) => {
    if (!matchesSearch(t)) return false;
    if (filter === "all") return true;
    if (filter === "assigned") return !!t.assignee_name;
    if (filter === "unassigned") return !t.assignee_name;
    return t.quadrant === filter;
  }), [openTasks, filter, matchesSearch]);

  const visibleDone = useMemo(() => doneTasks.filter(matchesSearch), [doneTasks, matchesSearch]);

  const byQuadrant = useMemo(() => {
    const m: Record<TaskQuadrant, TaskRow[]> = { do: [], schedule: [], delegate: [], eliminate: [] };
    for (const t of visibleOpen) m[t.quadrant].push(t);
    return m;
  }, [visibleOpen]);

  // Selection is always scoped to what is currently visible (filter + search aware).
  const selectableIds = useMemo(
    () => (showCompleted ? [...visibleOpen, ...visibleDone] : visibleOpen).map((t) => t.id),
    [visibleOpen, visibleDone, showCompleted],
  );
  const effectiveSelected = useMemo(
    () => selectableIds.filter((id) => selected.has(id)),
    [selectableIds, selected],
  );
  const allSelected = selectableIds.length > 0 && effectiveSelected.length === selectableIds.length;

  // ---- single-task actions (optimistic) ----
  const completeOne = async (t: TaskRow, done: boolean) => {
    patchLocal((rows) => rows.map((r) => r.id === t.id
      ? { ...r, status: done ? "done" : "open", completed_at: done ? new Date().toISOString() : null }
      : r));
    try { await toggleTaskDone(t.id, done); } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    refresh();
  };
  const deleteOne = async (t: TaskRow) => {
    patchLocal((rows) => rows.filter((r) => r.id !== t.id));
    try { await deleteTask(t.id); } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    refresh();
  };
  const patchOne = async (t: TaskRow, patch: Partial<TaskRow>) => {
    patchLocal((rows) => rows.map((r) => (r.id === t.id ? { ...r, ...patch } : r)));
    try { await updateTask(t.id, patch as any); } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    refresh();
  };

  // ---- bulk actions ----
  const [confirmDelete, setConfirmDelete] = useState<null | { ids: string[]; label: string }>(null);

  const bulkComplete = async () => {
    const ids = effectiveSelected;
    if (!ids.length) return;
    const set = new Set(ids);
    patchLocal((rows) => rows.map((r) => (set.has(r.id) ? { ...r, status: "done", completed_at: new Date().toISOString() } : r)));
    exitSelect();
    try { await bulkSetTaskStatus(ids, true); toast.success(`${ids.length} completed`); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
    refresh();
  };
  const bulkReopen = async (ids: string[]) => {
    if (!ids.length) return;
    const set = new Set(ids);
    patchLocal((rows) => rows.map((r) => (set.has(r.id) ? { ...r, status: "open", completed_at: null } : r)));
    exitSelect();
    try { await bulkSetTaskStatus(ids, false); } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    refresh();
  };
  const bulkMove = async (q: TaskQuadrant) => {
    const ids = effectiveSelected;
    if (!ids.length) return;
    const set = new Set(ids);
    patchLocal((rows) => rows.map((r) => (set.has(r.id) ? { ...r, quadrant: q } : r)));
    exitSelect();
    try { await bulkMoveTasks(ids, q); toast.success(`Moved ${ids.length} to ${quadStyles[q].title}`); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
    refresh();
  };
  const bulkAssign = async (name: string | null) => {
    const ids = effectiveSelected;
    if (!ids.length) return;
    const set = new Set(ids);
    patchLocal((rows) => rows.map((r) => (set.has(r.id) ? { ...r, assignee_name: name } : r)));
    exitSelect();
    try { await bulkAssignTasks(ids, name); } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    refresh();
  };
  const runDelete = async (ids: string[]) => {
    const set = new Set(ids);
    patchLocal((rows) => rows.filter((r) => !set.has(r.id)));
    exitSelect();
    setConfirmDelete(null);
    try { await bulkDeleteTasksByIds(ids); toast.success(`Deleted ${ids.length}`); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
    refresh();
  };

  const rowProps = {
    selectMode, selected, toggleSelected, quadStyles, assignees,
    onComplete: completeOne, onDelete: deleteOne, onPatch: patchOne, isMobile,
  };

  const FILTERS: { key: FilterKey; label: string }[] = [
    { key: "all", label: "All" },
    { key: "do", label: quadStyles.do.title },
    { key: "schedule", label: quadStyles.schedule.title },
    { key: "delegate", label: quadStyles.delegate.title },
    { key: "eliminate", label: quadStyles.eliminate.title },
    { key: "assigned", label: "Assigned" },
    { key: "unassigned", label: "Mine" },
  ];

  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setAssigneesOpen(true)}>
              <Users className="mr-1 h-4 w-4" />Assignees
            </Button>
            <Button
              variant={selectMode ? "default" : "outline"}
              size="sm"
              onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
            >
              {selectMode ? "Cancel" : "Select"}
            </Button>
          </div>
        }
      />

      <div className="space-y-3 p-3 pb-40 md:p-6 md:pb-10">
        {/* Quick add */}
        <div className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-2 py-1.5">
          <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            ref={addRef}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); quickAdd(newTitle, defaultQuadrant); } }}
            placeholder="Add task…"
            enterKeyHint="done"
            className="h-9 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1 px-2 text-[11px] font-semibold">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: quadStyles[defaultQuadrant].color }} />
                <span className="hidden sm:inline">{quadStyles[defaultQuadrant].title}</span>
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-widest">Default category</DropdownMenuLabel>
              {QUADRANTS.map((q) => (
                <DropdownMenuItem key={q.key} onClick={() => pickDefaultQuadrant(q.key)}>
                  <span className="mr-2 h-2 w-2 rounded-full" style={{ backgroundColor: quadStyles[q.key].color }} />
                  {quadStyles[q.key].title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* View switch + counts + search */}
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border bg-card p-0.5">
            <Button size="sm" variant={view === "list" ? "default" : "ghost"} className="h-7 px-2.5 text-xs" onClick={() => switchView("list")}>
              <ListChecks className="mr-1 h-3.5 w-3.5" />List
            </Button>
            <Button size="sm" variant={view === "matrix" ? "default" : "ghost"} className="h-7 px-2.5 text-xs" onClick={() => switchView("matrix")}>
              <LayoutGrid className="mr-1 h-3.5 w-3.5" />Matrix
            </Button>
          </div>
          <span className="text-xs font-semibold text-muted-foreground">{visibleOpen.length} open</span>
          <Button
            variant="ghost" size="icon" className="ml-auto h-8 w-8"
            aria-label="Search tasks"
            onClick={() => { setSearchOpen((o) => !o); if (searchOpen) setSearch(""); }}
          >
            <Search className="h-4 w-4" />
          </Button>
        </div>

        {searchOpen && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, notes, assignee…" className="h-9 pl-8 text-sm"
            />
          </div>
        )}

        {/* Filters */}
        <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5 md:mx-0 md:px-0">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                  active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* Selection header */}
        {selectMode && (
          <div className="flex items-center justify-between rounded-lg border border-primary/50 bg-primary/5 px-3 py-1.5">
            <span className="text-xs font-bold">{effectiveSelected.length} selected</span>
            <Button
              variant="ghost" size="sm" className="h-7 px-2 text-xs"
              onClick={() => setSelected(allSelected ? new Set() : new Set(selectableIds))}
            >
              {allSelected ? "Deselect all" : "Select all"}
            </Button>
          </div>
        )}

        {/* LIST */}
        {view === "list" && (
          <Card className="overflow-hidden border-border bg-card p-0">
            {visibleOpen.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                {search || filter !== "all" ? "No matching tasks." : "Nothing open. Type above to add one."}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {visibleOpen.map((t) => <TaskRow key={t.id} task={t} {...rowProps} />)}
              </ul>
            )}
          </Card>
        )}

        {/* MATRIX */}
        {view === "matrix" && (
          <div className="grid gap-2 md:grid-cols-2">
            {QUADRANTS.map((q) => (
              <QuadrantPanel
                key={q.key}
                quadrant={q.key}
                style={quadStyles[q.key]}
                tasks={byQuadrant[q.key]}
                defaultOpen={!isMobile || q.key === "do"}
                onCustomize={(p) => updateQuadStyle(q.key, p)}
                onResetStyle={() => resetQuadStyle(q.key)}
                onSelectAllHere={(ids) => { setSelectMode(true); setSelected(new Set(ids)); }}
                rowProps={rowProps}
              />
            ))}
          </div>
        )}

        {/* Completed */}
        {doneTasks.length > 0 && (
          <Card className="overflow-hidden border-border bg-card p-0">
            <button
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
              onClick={() => setShowCompleted((o) => !o)}
            >
              {showCompleted ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Completed ({visibleDone.length})
              </span>
              {showCompleted && visibleDone.length > 0 && (
                <span
                  role="button"
                  tabIndex={0}
                  className="ml-auto text-[11px] font-semibold text-destructive"
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete({ ids: visibleDone.map((t) => t.id), label: `all ${visibleDone.length} completed tasks` }); }}
                >
                  Clear completed
                </span>
              )}
            </button>
            {showCompleted && (
              <ul className="divide-y divide-border border-t border-border">
                {visibleDone.map((t) => <TaskRow key={t.id} task={t} {...rowProps} />)}
              </ul>
            )}
          </Card>
        )}

        {/* Quick Notes */}
        <QuickNotesPanel
          storageKey={`${storagePrefix}-task-notes`}
          quadStyles={quadStyles}
          onConvert={async (note, quadrant, assignee) => {
            const t = (note.title || note.body).trim().slice(0, 200);
            if (!t) return;
            await createTask({ title: t, quadrant, scope, notes: note.title ? note.body : null, assignee_name: assignee });
            refresh();
            toast.success("Converted to task");
          }}
          assignees={assignees}
        />
      </div>

      {/* Sticky bulk action bar (sits above the mobile bottom nav) */}
      {selectMode && effectiveSelected.length > 0 && (
        <div
          className="fixed left-3 right-3 z-50 md:left-auto md:right-8"
          style={{ bottom: isMobile ? "calc(max(env(safe-area-inset-bottom), 6px) + 74px)" : "1.5rem" }}
        >
          <div className="flex items-center gap-1.5 rounded-2xl border border-border bg-card/95 px-2.5 py-2 shadow-lg backdrop-blur">
            <span className="px-1 text-xs font-bold">{effectiveSelected.length}</span>
            <Button size="sm" variant="secondary" className="h-8 px-2.5 text-xs" onClick={bulkComplete}>
              <CheckCheck className="mr-1 h-3.5 w-3.5" />Complete
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="secondary" className="h-8 px-2.5 text-xs">
                  <ArrowRightLeft className="mr-1 h-3.5 w-3.5" />Move
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" side="top">
                <DropdownMenuLabel className="text-[10px] uppercase tracking-widest">Move to</DropdownMenuLabel>
                {QUADRANTS.map((q) => (
                  <DropdownMenuItem key={q.key} onClick={() => bulkMove(q.key)}>
                    <span className="mr-2 h-2 w-2 rounded-full" style={{ backgroundColor: quadStyles[q.key].color }} />
                    {quadStyles[q.key].title}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm" variant="destructive" className="h-8 px-2.5 text-xs"
              onClick={() => setConfirmDelete({ ids: effectiveSelected, label: `${effectiveSelected.length} task${effectiveSelected.length === 1 ? "" : "s"}` })}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />Delete
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0"><MoreHorizontal className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top">
                <DropdownMenuItem onClick={() => bulkReopen(effectiveSelected)}>
                  <RotateCcw className="mr-2 h-4 w-4" />Reopen
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px] uppercase tracking-widest">Assign to</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => bulkAssign(null)}>Unassigned</DropdownMenuItem>
                {assignees.map((a) => (
                  <DropdownMenuItem key={a.id} onClick={() => bulkAssign(a.name)}>{a.name}</DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {confirmDelete?.label}?</DialogTitle>
            <DialogDescription>This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => confirmDelete && runDelete(confirmDelete.ids)}>
              Delete {confirmDelete?.ids.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AssigneesDialog
        open={assigneesOpen}
        onOpenChange={setAssigneesOpen}
        assignees={assignees}
        setAssignees={setAssignees}
      />
    </>
  );
}

// ---------------------------------------------------------------- task row

type RowProps = {
  selectMode: boolean;
  selected: Set<string>;
  toggleSelected: (id: string) => void;
  quadStyles: Record<TaskQuadrant, QuadStyle>;
  assignees: Assignee[];
  onComplete: (t: TaskRow, done: boolean) => void;
  onDelete: (t: TaskRow) => void;
  onPatch: (t: TaskRow, patch: Partial<TaskRow>) => void;
  isMobile: boolean;
};

function TaskRow({ task, ...p }: { task: TaskRow } & RowProps) {
  const isDone = task.status === "done";
  const qs = p.quadStyles[task.quadrant];
  const isSelected = p.selected.has(task.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);

  const body = (
    <li
      className={cn(
        "flex items-start gap-2.5 px-3 py-2",
        isSelected && "bg-primary/5",
      )}
      onClick={p.selectMode ? () => p.toggleSelected(task.id) : undefined}
    >
      <Checkbox
        checked={p.selectMode ? isSelected : isDone}
        onCheckedChange={(v) => (p.selectMode ? p.toggleSelected(task.id) : p.onComplete(task, !!v))}
        onClick={(e) => e.stopPropagation()}
        className="mt-0.5 h-[18px] w-[18px]"
        aria-label={p.selectMode ? "Select task" : "Complete task"}
      />
      <div className="min-w-0 flex-1">
        {editing ? (
          <Input
            autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { setEditing(false); if (draft.trim() && draft !== task.title) p.onPatch(task, { title: draft.trim() }); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") { setDraft(task.title); setEditing(false); }
            }}
            className="h-7 text-sm"
          />
        ) : (
          <div className={cn("text-sm leading-snug", isDone && "text-muted-foreground line-through")}>{task.title}</div>
        )}
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: qs.color }} />
            {qs.title}
          </span>
          {task.assignee_name && <span>· {task.assignee_name}</span>}
        </div>
      </div>
      {!p.selectMode && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"><MoreHorizontal className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => { setDraft(task.title); setEditing(true); }}>
              <Pencil className="mr-2 h-4 w-4" />Edit
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><ArrowRightLeft className="mr-2 h-4 w-4" />Move</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {QUADRANTS.map((q) => (
                  <DropdownMenuItem key={q.key} disabled={q.key === task.quadrant} onClick={() => p.onPatch(task, { quadrant: q.key })}>
                    <span className="mr-2 h-2 w-2 rounded-full" style={{ backgroundColor: p.quadStyles[q.key].color }} />
                    {p.quadStyles[q.key].title}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><Users className="mr-2 h-4 w-4" />Assign</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onClick={() => p.onPatch(task, { assignee_name: null })}>Unassigned</DropdownMenuItem>
                {p.assignees.length === 0 && (
                  <div className="px-2 py-1.5 text-[11px] text-muted-foreground">Add names in “Assignees”.</div>
                )}
                {p.assignees.map((a) => (
                  <DropdownMenuItem key={a.id} onClick={() => p.onPatch(task, { assignee_name: a.name })}>{a.name}</DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onClick={() => p.onComplete(task, !isDone)}>
              {isDone ? <><RotateCcw className="mr-2 h-4 w-4" />Restore</> : <><Check className="mr-2 h-4 w-4" />Complete</>}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={() => p.onDelete(task)}>
              <Trash2 className="mr-2 h-4 w-4" />Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );

  if (!p.isMobile || p.selectMode || editing) return body;
  return (
    <TaskSwipeRow
      onSwipeRight={() => p.onComplete(task, !isDone)}
      onSwipeLeft={() => p.onDelete(task)}
    >
      {body}
    </TaskSwipeRow>
  );
}

// ---------------------------------------------------------------- matrix quadrant

function QuadrantPanel({
  quadrant, style, tasks, defaultOpen, onCustomize, onResetStyle, onSelectAllHere, rowProps,
}: {
  quadrant: TaskQuadrant;
  style: QuadStyle;
  tasks: TaskRow[];
  defaultOpen: boolean;
  onCustomize: (p: Partial<QuadStyle>) => void;
  onResetStyle: () => void;
  onSelectAllHere: (ids: string[]) => void;
  rowProps: RowProps;
}) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { setOpen(defaultOpen); }, [defaultOpen]);
  return (
    <Card className="overflow-hidden border p-0" style={tintStyle(style.color)}>
      <div className="flex items-center gap-2 px-2.5 py-2">
        <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronDown className="h-4 w-4 shrink-0 opacity-60" /> : <ChevronRight className="h-4 w-4 shrink-0 opacity-60" />}
          <span className="truncate text-sm font-black tracking-tight" style={{ color: style.color }}>{style.title}</span>
          <Badge variant="outline" className="ml-auto shrink-0 text-[10px]" style={{ borderColor: `${style.color}80`, color: style.color }}>
            {tasks.length}
          </Badge>
        </button>
        {tasks.length > 0 && (
          <Button variant="ghost" size="sm" className="h-7 px-1.5 text-[10px]" onClick={() => onSelectAllHere(tasks.map((t) => t.id))}>
            Select
          </Button>
        )}
        <QuadrantCustomizer style={style} onChange={onCustomize} onReset={onResetStyle} />
      </div>
      {open && (
        tasks.length === 0 ? (
          <div className="px-3 pb-3 text-[11px] text-muted-foreground">Nothing here.</div>
        ) : (
          <ul className="divide-y divide-border/60 border-t border-border/60 bg-card/60">
            {tasks.map((t) => <TaskRow key={t.id} task={t} {...rowProps} />)}
          </ul>
        )
      )}
      <span className="sr-only">{quadrant}</span>
    </Card>
  );
}

function QuadrantCustomizer({ style, onChange, onReset }: { style: QuadStyle; onChange: (p: Partial<QuadStyle>) => void; onReset: () => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Customize quadrant">
          <Settings2 className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Color</Label>
          <div className="flex items-center gap-2">
            <input
              type="color" value={style.color} onChange={(e) => onChange({ color: e.target.value })}
              className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent" aria-label="Pick color"
            />
            <Input value={style.color} onChange={(e) => onChange({ color: e.target.value })} className="h-9 flex-1 font-mono text-xs" />
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

// ---------------------------------------------------------------- quick notes

function QuickNotesPanel({
  storageKey, quadStyles, assignees, onConvert,
}: {
  storageKey: string;
  quadStyles: Record<TaskQuadrant, QuadStyle>;
  assignees: Assignee[];
  onConvert: (note: Note, quadrant: TaskQuadrant, assignee: string | null) => Promise<void>;
}) {
  const [notes, setNotes] = useNotes(storageKey);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);

  const addNote = useCallback(() => {
    const n: Note = { id: newId(), title: "", body: "", updatedAt: Date.now() };
    setNotes((arr) => [n, ...arr]);
    setExpanded(n.id);
  }, [setNotes]);

  const updateNote = (id: string, patch: Partial<Note>) =>
    setNotes((arr) => arr.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n)));
  const removeNotes = (ids: string[]) => {
    const set = new Set(ids);
    setNotes((arr) => arr.filter((n) => !set.has(n.id)));
    setSelected(new Set());
  };
  const duplicate = (n: Note) => setNotes((arr) => [{ ...n, id: newId(), updatedAt: Date.now() }, ...arr]);

  const allSelected = notes.length > 0 && selected.size === notes.length;

  return (
    <Card className="overflow-hidden border-border bg-card p-0">
      <div className="flex items-center gap-2 px-3 py-2">
        <StickyNote className="h-4 w-4 text-primary" />
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Quick Notes</h2>
        <Badge variant="outline" className="text-[10px]">{notes.length}</Badge>
        <div className="ml-auto flex items-center gap-1">
          {notes.length > 0 && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]"
              onClick={() => { setSelectMode((s) => !s); setSelected(new Set()); }}>
              {selectMode ? "Cancel" : "Select"}
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={addNote}>
            <Plus className="mr-1 h-3.5 w-3.5" />Note
          </Button>
        </div>
      </div>

      {selectMode && (
        <div className="flex items-center justify-between border-t border-border bg-primary/5 px-3 py-1.5">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]"
            onClick={() => setSelected(allSelected ? new Set() : new Set(notes.map((n) => n.id)))}>
            {allSelected ? "Deselect all" : "Select all"}
          </Button>
          <span className="text-[11px] font-bold">{selected.size} selected</span>
          <Button variant="destructive" size="sm" className="h-7 px-2 text-[11px]"
            disabled={selected.size === 0} onClick={() => removeNotes(Array.from(selected))}>
            <Trash2 className="mr-1 h-3.5 w-3.5" />Delete
          </Button>
        </div>
      )}

      {notes.length === 0 ? (
        <div className="border-t border-border px-3 py-3 text-[11px] text-muted-foreground">
          No notes yet — tap “Note” to jot something down. Auto-saves as you type.
        </div>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {notes.map((n) => {
            const isOpen = expanded === n.id;
            const preview = (n.title || n.body || "Untitled note").split("\n")[0];
            return (
              <li key={n.id} className="px-3 py-2">
                <div className="flex items-start gap-2.5">
                  {selectMode && (
                    <Checkbox
                      className="mt-0.5 h-[18px] w-[18px]"
                      checked={selected.has(n.id)}
                      onCheckedChange={(v) => setSelected((s) => { const x = new Set(s); v ? x.add(n.id) : x.delete(n.id); return x; })}
                    />
                  )}
                  <button className="min-w-0 flex-1 text-left" onClick={() => setExpanded(isOpen ? null : n.id)}>
                    <div className="truncate text-sm">{preview}</div>
                    {!isOpen && n.body && n.title && (
                      <div className="truncate text-[11px] text-muted-foreground">{n.body}</div>
                    )}
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"><MoreHorizontal className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger><ListTodo className="mr-2 h-4 w-4" />Convert to task</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          {QUADRANTS.map((q) => (
                            <DropdownMenuItem key={q.key} onClick={() => onConvert(n, q.key, null)}>
                              <span className="mr-2 h-2 w-2 rounded-full" style={{ backgroundColor: quadStyles[q.key].color }} />
                              {quadStyles[q.key].title}
                            </DropdownMenuItem>
                          ))}
                          {assignees.length > 0 && <DropdownMenuSeparator />}
                          {assignees.map((a) => (
                            <DropdownMenuItem key={a.id} onClick={() => onConvert(n, "do", a.name)}>
                              <Users className="mr-2 h-4 w-4" />{a.name}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuItem onClick={() => duplicate(n)}><Copy className="mr-2 h-4 w-4" />Duplicate</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive" onClick={() => removeNotes([n.id])}>
                        <Trash2 className="mr-2 h-4 w-4" />Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {isOpen && (
                  <div className="mt-2 space-y-1.5">
                    <Input
                      value={n.title} placeholder="Title (optional)" autoFocus={!n.title && !n.body}
                      onChange={(e) => updateNote(n.id, { title: e.target.value })} className="h-8 text-sm"
                    />
                    <Textarea
                      value={n.body} placeholder="Write it down…" rows={4}
                      onChange={(e) => updateNote(n.id, { body: e.target.value })} className="text-sm"
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- assignees

function AssigneesDialog({
  open, onOpenChange, assignees, setAssignees,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  assignees: Assignee[];
  setAssignees: React.Dispatch<React.SetStateAction<Assignee[]>>;
}) {
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const add = () => {
    const n = name.trim();
    if (!n) return;
    setAssignees((arr) => [...arr, { id: newId(), name: n }]);
    setName("");
  };
  const startEdit = (a: Assignee) => { setEditingId(a.id); setEditingName(a.name); };
  const saveEdit = () => {
    const n = editingName.trim();
    if (n) setAssignees((arr) => arr.map((a) => (a.id === editingId ? { ...a, name: n } : a)));
    setEditingId(null);
  };
  const deleteOne = (id: string) => {
    setAssignees((arr) => arr.filter((a) => a.id !== id));
    setSelected((s) => { const x = new Set(s); x.delete(id); return x; });
  };
  const toggleSelect = (id: string, on: boolean) =>
    setSelected((s) => { const x = new Set(s); on ? x.add(id) : x.delete(id); return x; });
  const allSelected = assignees.length > 0 && selected.size === assignees.length;
  const someSelected = selected.size > 0 && !allSelected;
  const toggleAll = (on: boolean) => setSelected(on ? new Set(assignees.map((a) => a.id)) : new Set());
  const deleteSelected = () => {
    setAssignees((arr) => arr.filter((a) => !selected.has(a.id)));
    setSelected(new Set());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Manage assignees</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") add(); }}
              placeholder="Add a name" className="h-9"
            />
            <Button onClick={add} className="h-9"><Plus className="mr-1 h-4 w-4" />Add</Button>
          </div>

          {assignees.length > 0 && (
            <div className="flex items-center justify-between border-t border-border pt-2">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={(v) => toggleAll(!!v)}
                />
                Select all
              </label>
              {selected.size > 0 && (
                <Button variant="destructive" size="sm" onClick={deleteSelected}>
                  <Trash2 className="mr-1 h-3.5 w-3.5" />Delete ({selected.size})
                </Button>
              )}
            </div>
          )}

          <div className="max-h-72 space-y-1 overflow-y-auto">
            {assignees.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No names yet. Add your first assignee above.
              </div>
            ) : (
              assignees.map((a) => {
                const isEditing = editingId === a.id;
                const isSelected = selected.has(a.id);
                return (
                  <div
                    key={a.id}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-2 py-1.5",
                      isSelected ? "border-primary/60 bg-primary/5" : "border-border/60",
                    )}
                  >
                    <Checkbox checked={isSelected} onCheckedChange={(v) => toggleSelect(a.id, !!v)} />
                    {isEditing ? (
                      <Input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingId(null); }}
                        autoFocus className="h-8 flex-1"
                      />
                    ) : (
                      <span className="flex-1 truncate text-sm">{a.name}</span>
                    )}
                    {isEditing ? (
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={saveEdit} aria-label="Save">
                        <Check className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(a)} aria-label="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteOne(a.id)} aria-label="Delete">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
