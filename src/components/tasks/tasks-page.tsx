/**
 * Task Manager.
 *
 * - Two boards. "My tasks" is the person's own list: their private tasks plus
 *   team tasks assigned to them. "Team" is the shared board everyone on the
 *   team works together. Private tasks (tasks.owner_user_id) are enforced by
 *   the database, so nobody else ever sees them, "view as" included.
 * - Quick Notes sit above both, private to the person, and can be sent to
 *   either board (see quick-notes.tsx).
 * - List view groups tasks by category. Matrix view is a 2×2 overview: each
 *   quadrant shows a short preview and opens into its full list.
 * - Tapping a task opens it: title, notes, category, who it's for, who sees it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { AutoGrowTextarea } from "@/components/ui/auto-grow-textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  Plus, MoreHorizontal, Trash2, Settings2, RotateCcw, Users, Check, Lock,
  Search, ListChecks, LayoutGrid, ChevronRight, ChevronDown, CheckCheck, ArrowRightLeft, Maximize2, UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  QUADRANTS, fetchTasks, createTask, toggleTaskDone, fetchTeamMembers, splitTasks, firstName,
  updateTask, deleteTask, bulkSetTaskStatus, bulkMoveTasks, bulkAssignTasks, bulkDeleteTasksByIds,
  type TaskRow, type TaskQuadrant, type TaskScope, type TeamMember,
} from "@/lib/tasks";
import { useIsMobile } from "@/hooks/use-mobile";
import { TaskSwipeRow } from "@/components/tasks/task-swipe-row";
import { cn } from "@/lib/utils";
import { QuickNotesPanel } from "@/components/tasks/quick-notes";
import { watchTasksRealtime } from "@/lib/tasks-realtime";

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

/** A small UI choice remembered on this device. */
function useRemembered<T extends string>(key: string, initial: T, allowed: readonly T[]) {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    try {
      const s = localStorage.getItem(key) as T | null;
      if (s && allowed.includes(s)) setV(s);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = useCallback((next: T) => {
    setV(next);
    try { localStorage.setItem(key, next); } catch {}
  }, [key]);
  return [v, set] as const;
}

const newId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

type Board = "mine" | "team";
/** Team board filter: everyone, me, unassigned, or one teammate's user id. */
type PersonFilter = "all" | "me" | "none" | string;

/** Tasks shown in a matrix quadrant before "Open". */
const PREVIEW_ROWS = 3;

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
  const { user, preview } = useAuth();
  const me = user?.id ?? null;
  /** Viewing as someone else: their private tasks and notes stay private. */
  const privateTo = preview?.name ?? null;

  const queryKey = useMemo(() => ["tasks", scope] as const, [scope]);
  const { data: tasks = [] } = useQuery({ queryKey, queryFn: () => fetchTasks(scope) });
  const { data: teamMembers = [] } = useQuery({
    queryKey: ["task-team-members"], queryFn: fetchTeamMembers, staleTime: 5 * 60_000,
  });
  const { styles: quadStyles, update: updateQuadStyle, reset: resetQuadStyle } =
    useQuadrantStyles(`${storagePrefix}-quadrant-styles`);

  // realtime — canonical source of truth. Rebuilt on app resume / reconnect
  // so a phone that slept still shows what was changed on another device.
  useEffect(
    () => watchTasksRealtime({
      client: supabase,
      name: `${storagePrefix}-tasks-rt`,
      table: "tasks",
      filter: `scope=eq.${scope}`,
      onChange: () => { qc.invalidateQueries({ queryKey: ["tasks", scope] }); },
    }),
    [qc, storagePrefix, scope],
  );

  // ---- local cache helpers (optimistic) ----
  const patchLocal = useCallback((fn: (rows: TaskRow[]) => TaskRow[]) => {
    qc.setQueryData(queryKey, (prev: TaskRow[] | undefined) => fn(prev ?? []));
  }, [qc, queryKey]);
  const refresh = useCallback(() => { qc.invalidateQueries({ queryKey: ["tasks", scope] }); }, [qc, scope]);

  // ---- board / view / filter state ----
  const [board, setBoard] = useRemembered<Board>(`${storagePrefix}-tasks-board`, "mine", ["mine", "team"]);
  const [view, setView] = useRemembered<"list" | "matrix">(`${storagePrefix}-tasks-view`, "list", ["list", "matrix"]);
  const [person, setPerson] = useState<PersonFilter>("all");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [openQuadrant, setOpenQuadrant] = useState<TaskQuadrant | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  // ---- quick add ----
  const [newTitle, setNewTitle] = useState("");
  const addRef = useRef<HTMLInputElement | null>(null);
  const [defaultQuadrant, setDefaultQuadrant] = useRemembered<TaskQuadrant>(
    `${storagePrefix}-tasks-default-quadrant`, "do", ["do", "schedule", "delegate", "eliminate"],
  );

  const memberById = useMemo(() => new Map(teamMembers.map((m) => [m.user_id, m])), [teamMembers]);
  const nameOf = useCallback(
    (t: Pick<TaskRow, "assigned_to" | "assignee_name">) =>
      (t.assigned_to && memberById.get(t.assigned_to)?.full_name) || t.assignee_name || null,
    [memberById],
  );

  /** Who a new team task is for: whoever the board is filtered to. */
  const filterAssignee = (): TeamMember | null => {
    if (board !== "team") return null;
    if (person === "me") return me ? memberById.get(me) ?? { user_id: me, full_name: "" } : null;
    if (person === "all" || person === "none") return null;
    return memberById.get(person) ?? null;
  };

  const addTask = useCallback(async (raw: string, quadrant: TaskQuadrant, opts?: { keepFocus?: boolean; board?: Board; assignee?: TeamMember | null }) => {
    const t = raw.trim();
    if (!t) return;
    const target = opts?.board ?? board;
    const assignee = target === "team" ? (opts?.assignee ?? null) : null;
    const owner = target === "mine" ? me : null;
    const temp: TaskRow = {
      id: `temp-${newId()}`, title: t, notes: null, quadrant, status: "open", priority: 0,
      due_at: null, created_by: null, assigned_to: assignee?.user_id ?? null, assignee_name: assignee?.full_name || null,
      completed_at: null, completed_by: null, position: 0, scope, owner_user_id: owner,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    patchLocal((rows) => [temp, ...rows]);
    try {
      await createTask({
        title: t, quadrant, scope, owner_user_id: owner,
        assigned_to: assignee?.user_id ?? null, assignee_name: assignee?.full_name || null,
      });
    } catch (e: any) {
      patchLocal((rows) => rows.filter((r) => r.id !== temp.id));
      toast.error(e?.message ?? "Could not add task");
      return;
    }
    refresh();
  }, [board, me, patchLocal, refresh, scope]);

  const quickAdd = (raw: string, quadrant: TaskQuadrant) => {
    if (!raw.trim()) return;
    setNewTitle("");
    addRef.current?.focus();
    void addTask(raw, quadrant, { assignee: filterAssignee() });
  };

  // ---- selection ----
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const clearSelection = () => setSelected(new Set());
  const exitSelect = () => { setSelectMode(false); clearSelection(); };
  const toggleSelected = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // Switching boards starts fresh: selection and person filter belong to one board.
  const switchBoard = (b: Board) => {
    if (b === board) return;
    setBoard(b);
    setPerson("all");
    exitSelect();
  };

  // ---- derived collections ----
  const { mine, team } = useMemo(() => splitTasks(tasks, me), [tasks, me]);
  const boardTasks = board === "mine" ? mine : team;
  const mineOpenCount = useMemo(() => mine.filter((t) => t.status === "open").length, [mine]);
  const teamOpenCount = useMemo(() => team.filter((t) => t.status === "open").length, [team]);
  /** The Mine board while viewing as someone else: theirs is private. */
  const boardHidden = board === "mine" && !!privateTo;

  const matchesSearch = useCallback((t: TaskRow) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [t.title, t.notes ?? "", nameOf(t) ?? ""].join(" ").toLowerCase().includes(q);
  }, [search, nameOf]);

  const matchesPerson = useCallback((t: TaskRow) => {
    if (board !== "team" || person === "all") return true;
    if (person === "me") return !!me && t.assigned_to === me;
    if (person === "none") return !t.assigned_to;
    return t.assigned_to === person;
  }, [board, person, me]);

  const visibleOpen = useMemo(
    () => boardHidden ? [] : boardTasks.filter((t) => t.status === "open" && matchesSearch(t) && matchesPerson(t)),
    [boardTasks, boardHidden, matchesSearch, matchesPerson],
  );
  const visibleDone = useMemo(
    () => boardHidden ? [] : boardTasks.filter((t) => t.status === "done" && matchesSearch(t) && matchesPerson(t)),
    [boardTasks, boardHidden, matchesSearch, matchesPerson],
  );

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
    if (detailId === t.id) setDetailId(null);
    try { await deleteTask(t.id); } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    refresh();
  };
  const patchOne = async (t: TaskRow, patch: Partial<TaskRow>) => {
    patchLocal((rows) => rows.map((r) => (r.id === t.id ? { ...r, ...patch } : r)));
    try { await updateTask(t.id, patch as any); } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    refresh();
  };
  const assignOne = (t: TaskRow, m: TeamMember | null) =>
    patchOne(t, { assigned_to: m?.user_id ?? null, assignee_name: m?.full_name ?? null });
  /** Personal → team board (optionally assigned). */
  const shareOne = (t: TaskRow, m: TeamMember | null) => {
    void patchOne(t, { owner_user_id: null, assigned_to: m?.user_id ?? null, assignee_name: m?.full_name ?? null });
    toast.success(m ? `On the team board for ${firstName(m.full_name)}` : "On the team board");
  };
  /** Team board → my private tasks. */
  const makePrivate = (t: TaskRow) => {
    if (!me) return;
    void patchOne(t, { owner_user_id: me, assigned_to: null, assignee_name: null });
    toast.success("Moved to your private tasks");
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
  const bulkAssign = async (m: TeamMember | null) => {
    const ids = effectiveSelected;
    if (!ids.length) return;
    const set = new Set(ids);
    patchLocal((rows) => rows.map((r) => (set.has(r.id) ? { ...r, assigned_to: m?.user_id ?? null, assignee_name: m?.full_name ?? null } : r)));
    exitSelect();
    try { await bulkAssignTasks(ids, m); } catch (e: any) { toast.error(e?.message ?? "Failed"); }
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

  const rowProps: RowProps = {
    selectMode, selected, toggleSelected, quadStyles, teamMembers, me, board, nameOf,
    onComplete: completeOne, onDelete: deleteOne, onPatch: patchOne, onAssign: assignOne,
    onShare: shareOne, onMakePrivate: makePrivate, onOpen: (t) => setDetailId(t.id), isMobile,
  };

  const detailTask = detailId ? tasks.find((t) => t.id === detailId) ?? null : null;
  useEffect(() => { if (detailId && !detailTask) setDetailId(null); }, [detailId, detailTask]);

  const PERSONS: { key: PersonFilter; label: string }[] = [
    { key: "all", label: "Everyone" },
    { key: "me", label: "Me" },
    { key: "none", label: "Unassigned" },
    ...teamMembers.filter((m) => m.user_id !== me).map((m) => ({ key: m.user_id, label: firstName(m.full_name) })),
  ];

  const emptyText = search || person !== "all"
    ? "No matching tasks."
    : board === "mine" ? "Nothing on your list. Type above to add one." : "Nothing on the team board. Type above to add one.";

  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost" size="icon" className="h-9 w-9"
              aria-label="Search tasks and notes"
              onClick={() => { setSearchOpen((o) => !o); if (searchOpen) setSearch(""); }}
            >
              <Search className="h-4 w-4" />
            </Button>
            {!boardHidden && (
              <Button
                variant={selectMode ? "default" : "outline"}
                size="sm"
                onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
              >
                {selectMode ? "Cancel" : "Select"}
              </Button>
            )}
          </div>
        }
      />

      <div className="space-y-3 p-3 pb-40 md:p-6 md:pb-10">
        {searchOpen && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks & quick notes…" className="h-9 pl-8 text-sm"
            />
          </div>
        )}

        {/* Quick Notes — private to each person */}
        <QuickNotesPanel
          storageKey={`${storagePrefix}-task-notes`}
          userId={me}
          privateTo={privateTo}
          quadStyles={quadStyles}
          teamMembers={teamMembers}
          onCreateTask={async (input) => {
            const assignee = input.team ? input.assignee ?? null : null;
            const id = await createTask({
              title: input.title, notes: input.notes, quadrant: input.quadrant, scope,
              owner_user_id: input.team ? null : me,
              assigned_to: assignee?.user_id ?? null, assignee_name: assignee?.full_name ?? null,
            });
            refresh();
            return id;
          }}
          onDeleteTask={async (id) => {
            await deleteTask(id);
            refresh();
          }}
          search={search}
          hideComposeButton={selectMode}
        />

        {/* Board switch: my list on top, the shared team board next to it */}
        <div className="grid grid-cols-2 rounded-xl border border-border bg-card p-1" role="tablist" aria-label="Task board">
          {([
            { key: "mine" as const, label: "My tasks", icon: UserRound, count: privateTo ? null : mineOpenCount },
            { key: "team" as const, label: "Team", icon: Users, count: teamOpenCount },
          ]).map((b) => {
            const active = board === b.key;
            const Icon = b.icon;
            return (
              <button
                key={b.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => switchBoard(b.key)}
                className={cn(
                  "flex h-10 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold transition-colors",
                  active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {b.label}
                {b.count != null && (
                  <span className={cn("tabular-nums text-xs", active ? "opacity-80" : "opacity-70")}>{b.count}</span>
                )}
              </button>
            );
          })}
        </div>

        {boardHidden ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{firstName(privateTo)}&apos;s own tasks are private to them. The Team board is shared.</span>
          </div>
        ) : (
          <>
            {/* Quick add */}
            <div className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-2 py-1.5">
              <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Input
                ref={addRef}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); quickAdd(newTitle, defaultQuadrant); } }}
                placeholder={board === "mine" ? "Add to my tasks…" : person !== "all" && person !== "none" ? `Add for ${PERSONS.find((p) => p.key === person)?.label ?? "them"}…` : "Add to the team board…"}
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
                    <DropdownMenuItem key={q.key} onClick={() => setDefaultQuadrant(q.key)}>
                      <span className="mr-2 h-2 w-2 rounded-full" style={{ backgroundColor: quadStyles[q.key].color }} />
                      {quadStyles[q.key].title}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* View switch + count */}
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border border-border bg-card p-0.5">
                <Button size="sm" variant={view === "list" ? "default" : "ghost"} className="h-7 px-2.5 text-xs" onClick={() => setView("list")}>
                  <ListChecks className="mr-1 h-3.5 w-3.5" />List
                </Button>
                <Button size="sm" variant={view === "matrix" ? "default" : "ghost"} className="h-7 px-2.5 text-xs" onClick={() => setView("matrix")}>
                  <LayoutGrid className="mr-1 h-3.5 w-3.5" />Matrix
                </Button>
              </div>
              <span className="ml-auto text-xs font-semibold text-muted-foreground">{visibleOpen.length} open</span>
            </div>

            {/* Team board: whose tasks */}
            {board === "team" && (
              <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5 md:mx-0 md:px-0">
                {PERSONS.map((f) => {
                  const active = person === f.key;
                  return (
                    <button
                      key={f.key}
                      onClick={() => setPerson(f.key)}
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
            )}

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

            {/* LIST — grouped by category */}
            {view === "list" && (
              visibleOpen.length === 0 ? (
                <Card className="border-border bg-card p-6 text-center text-xs text-muted-foreground">{emptyText}</Card>
              ) : (
                <div className="space-y-2">
                  {QUADRANTS.filter((q) => byQuadrant[q.key].length > 0).map((q) => {
                    const st = quadStyles[q.key];
                    return (
                      <Card key={q.key} className="overflow-hidden border-border bg-card p-0">
                        <div className="flex items-center gap-2 border-b border-border/70 px-3 py-1.5">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: st.color }} />
                          <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: st.color }}>{st.title}</span>
                          <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{byQuadrant[q.key].length}</span>
                        </div>
                        <ul className="divide-y divide-border">
                          {byQuadrant[q.key].map((t) => <TaskRowItem key={t.id} task={t} showQuadrant={false} {...rowProps} />)}
                        </ul>
                      </Card>
                    );
                  })}
                </div>
              )
            )}

            {/* MATRIX — 2×2 preview, each quadrant opens into its full list */}
            {view === "matrix" && (
              <div className="grid grid-cols-2 gap-2">
                {QUADRANTS.map((q) => (
                  <QuadrantPreview
                    key={q.key}
                    style={quadStyles[q.key]}
                    tasks={byQuadrant[q.key]}
                    isMobile={isMobile}
                    nameOf={board === "team" ? nameOf : undefined}
                    onOpen={() => setOpenQuadrant(q.key)}
                  />
                ))}
              </div>
            )}

            {/* Completed */}
            {visibleDone.length > 0 && (
              <Card className="overflow-hidden border-border bg-card p-0">
                <button
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                  onClick={() => setShowCompleted((o) => !o)}
                >
                  {showCompleted ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Completed ({visibleDone.length})
                  </span>
                  {showCompleted && (
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
                    {visibleDone.map((t) => <TaskRowItem key={t.id} task={t} showQuadrant {...rowProps} />)}
                  </ul>
                )}
              </Card>
            )}
          </>
        )}
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
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="More bulk actions"><MoreHorizontal className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top">
                <DropdownMenuItem onClick={() => bulkReopen(effectiveSelected)}>
                  <RotateCcw className="mr-2 h-4 w-4" />Reopen
                </DropdownMenuItem>
                {board === "team" && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-widest">Assign to</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => bulkAssign(null)}>Unassigned</DropdownMenuItem>
                    {teamMembers.map((m) => (
                      <DropdownMenuItem key={m.user_id} onClick={() => bulkAssign(m)}>
                        {m.user_id === me ? "Me" : m.full_name}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      <QuadrantSheet
        quadrant={openQuadrant}
        style={openQuadrant ? quadStyles[openQuadrant] : null}
        tasks={openQuadrant ? byQuadrant[openQuadrant] : []}
        board={board}
        onClose={() => setOpenQuadrant(null)}
        onAdd={(text) => openQuadrant && void addTask(text, openQuadrant, { assignee: filterAssignee() })}
        onCustomize={(p) => openQuadrant && updateQuadStyle(openQuadrant, p)}
        onResetStyle={() => openQuadrant && resetQuadStyle(openQuadrant)}
        rowProps={{ ...rowProps, selectMode: false }}
      />

      <TaskDetailSheet
        task={detailTask}
        quadStyles={quadStyles}
        teamMembers={teamMembers}
        me={me}
        nameOf={nameOf}
        onClose={() => setDetailId(null)}
        onPatch={patchOne}
        onComplete={completeOne}
        onDelete={(t) => setConfirmDelete({ ids: [t.id], label: `“${t.title}”` })}
        onShare={shareOne}
        onMakePrivate={makePrivate}
      />

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="break-words">Delete {confirmDelete?.label}?</DialogTitle>
            <DialogDescription>This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!confirmDelete) return;
                if (detailId && confirmDelete.ids.includes(detailId)) setDetailId(null);
                void runDelete(confirmDelete.ids);
              }}
            >
              Delete{confirmDelete && confirmDelete.ids.length > 1 ? ` ${confirmDelete.ids.length}` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------- task row

type RowProps = {
  selectMode: boolean;
  selected: Set<string>;
  toggleSelected: (id: string) => void;
  quadStyles: Record<TaskQuadrant, QuadStyle>;
  teamMembers: TeamMember[];
  me: string | null;
  board: Board;
  nameOf: (t: Pick<TaskRow, "assigned_to" | "assignee_name">) => string | null;
  onComplete: (t: TaskRow, done: boolean) => void;
  onDelete: (t: TaskRow) => void;
  onPatch: (t: TaskRow, patch: Partial<TaskRow>) => void;
  onAssign: (t: TaskRow, m: TeamMember | null) => void;
  onShare: (t: TaskRow, m: TeamMember | null) => void;
  onMakePrivate: (t: TaskRow) => void;
  onOpen: (t: TaskRow) => void;
  isMobile: boolean;
};

/** Who a team task is for, as a menu: Unassigned + every teammate. */
function PeopleItems({ members, me, current, onPick }: { members: TeamMember[]; me: string | null; current?: string | null; onPick: (m: TeamMember | null) => void }) {
  return (
    <>
      <DropdownMenuItem onClick={() => onPick(null)}>
        {current === null ? <Check className="mr-2 h-4 w-4" /> : <span className="mr-2 w-4" />}Unassigned
      </DropdownMenuItem>
      {members.map((m) => (
        <DropdownMenuItem key={m.user_id} onClick={() => onPick(m)}>
          {current === m.user_id ? <Check className="mr-2 h-4 w-4" /> : <span className="mr-2 w-4" />}
          {m.user_id === me ? "Me" : m.full_name}
        </DropdownMenuItem>
      ))}
    </>
  );
}

function TaskRowItem({ task, showQuadrant = true, ...p }: { task: TaskRow; showQuadrant?: boolean } & RowProps) {
  const isDone = task.status === "done";
  const qs = p.quadStyles[task.quadrant];
  const isSelected = p.selected.has(task.id);
  const personal = !!task.owner_user_id;
  const assignee = p.nameOf(task);
  const notesLine = (task.notes ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";

  const meta: React.ReactNode[] = [];
  if (showQuadrant) {
    meta.push(
      <span key="q" className="inline-flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: qs.color }} />
        {qs.title}
      </span>,
    );
  }
  if (!personal && p.board === "mine") meta.push(<span key="team" className="inline-flex items-center gap-0.5"><Users className="h-2.5 w-2.5" />Team</span>);
  if (!personal && p.board === "team" && assignee) {
    meta.push(<span key="who" className="font-semibold text-foreground/70">{task.assigned_to === p.me ? "Me" : firstName(assignee)}</span>);
  }

  const body = (
    <li
      className={cn("flex items-start gap-2.5 px-3 py-2", isSelected && "bg-primary/5")}
      onClick={p.selectMode ? () => p.toggleSelected(task.id) : undefined}
    >
      <Checkbox
        checked={p.selectMode ? isSelected : isDone}
        onCheckedChange={(v) => (p.selectMode ? p.toggleSelected(task.id) : p.onComplete(task, !!v))}
        onClick={(e) => e.stopPropagation()}
        className="mt-0.5 h-[18px] w-[18px]"
        aria-label={p.selectMode ? "Select task" : "Complete task"}
      />
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={(e) => { if (p.selectMode) return; e.stopPropagation(); p.onOpen(task); }}
        tabIndex={p.selectMode ? -1 : 0}
      >
        <div className={cn("line-clamp-2 text-sm leading-snug", isDone && "text-muted-foreground line-through")}>{task.title}</div>
        {notesLine && <div className="truncate text-xs leading-snug text-muted-foreground">{notesLine}</div>}
        {meta.length > 0 && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground">
            {meta.map((m, i) => <span key={i} className="inline-flex items-center gap-1.5">{i > 0 && <span aria-hidden>·</span>}{m}</span>)}
          </div>
        )}
      </button>
      {!p.selectMode && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Task actions"><MoreHorizontal className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => p.onOpen(task)}>
              <Maximize2 className="mr-2 h-4 w-4" />Open
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
            {personal ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger><Users className="mr-2 h-4 w-4" />Send to team</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <PeopleItems members={p.teamMembers} me={p.me} onPick={(m) => p.onShare(task, m)} />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger><UserRound className="mr-2 h-4 w-4" />Assign</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <PeopleItems members={p.teamMembers} me={p.me} current={task.assigned_to} onPick={(m) => p.onAssign(task, m)} />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
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

  if (!p.isMobile || p.selectMode) return body;
  return (
    <TaskSwipeRow
      onSwipeRight={() => p.onComplete(task, !isDone)}
      onSwipeLeft={() => p.onDelete(task)}
    >
      {body}
    </TaskSwipeRow>
  );
}

// ---------------------------------------------------------------- matrix

/** One quadrant of the 2×2 overview: count, the first few tasks, and a way in. */
function QuadrantPreview({
  style, tasks, isMobile, nameOf, onOpen,
}: {
  style: QuadStyle;
  tasks: TaskRow[];
  isMobile: boolean;
  /** Team board: show who each task is for. */
  nameOf?: (t: Pick<TaskRow, "assigned_to" | "assignee_name">) => string | null;
  onOpen: () => void;
}) {
  const rows = isMobile ? PREVIEW_ROWS : PREVIEW_ROWS + 2;
  const shown = tasks.slice(0, rows);
  const more = tasks.length - shown.length;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-[148px] flex-col rounded-xl border p-2.5 text-left transition-transform active:scale-[0.99] md:min-h-[188px] md:p-3"
      style={tintStyle(style.color)}
      aria-label={`${style.title}: ${tasks.length} open. Open the full list.`}
    >
      <div className="flex w-full items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[13px] font-black tracking-tight md:text-sm" style={{ color: style.color }}>{style.title}</span>
        <span
          className="shrink-0 rounded-full border px-1.5 text-[10px] font-bold tabular-nums"
          style={{ borderColor: `${style.color}80`, color: style.color }}
        >
          {tasks.length}
        </span>
      </div>
      <div className="mb-1.5 truncate text-[10px] text-muted-foreground">{style.subtitle}</div>
      {shown.length === 0 ? (
        <div className="flex flex-1 items-center text-[11px] text-muted-foreground/80">Nothing here.</div>
      ) : (
        <ul className="flex-1 space-y-1">
          {shown.map((t) => {
            const who = nameOf?.(t);
            return (
              <li key={t.id} className="flex min-w-0 items-start gap-1.5 text-xs leading-snug">
                <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: style.color }} />
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                {who && <span className="hidden shrink-0 text-[10px] text-muted-foreground sm:inline">{firstName(who)}</span>}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-1.5 flex w-full items-center text-[11px] font-semibold" style={{ color: style.color }}>
        <span>{more > 0 ? `+${more} more` : tasks.length > 0 ? "Open" : "Add"}</span>
        <ChevronRight className="ml-auto h-3.5 w-3.5" />
      </div>
    </button>
  );
}

/** A quadrant opened in full: every task, with add and all the row actions. */
function QuadrantSheet({
  quadrant, style, tasks, board, onClose, onAdd, onCustomize, onResetStyle, rowProps,
}: {
  quadrant: TaskQuadrant | null;
  style: QuadStyle | null;
  tasks: TaskRow[];
  board: Board;
  onClose: () => void;
  onAdd: (text: string) => void;
  onCustomize: (p: Partial<QuadStyle>) => void;
  onResetStyle: () => void;
  rowProps: RowProps;
}) {
  const [draft, setDraft] = useState("");
  useEffect(() => { setDraft(""); }, [quadrant]);
  const add = () => { if (draft.trim()) { onAdd(draft); setDraft(""); } };
  return (
    <Sheet open={!!quadrant} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        hideCloseButton
        className="flex max-h-[88dvh] flex-col gap-0 rounded-t-2xl p-0 md:inset-x-0 md:bottom-6 md:mx-auto md:max-w-xl md:rounded-2xl md:border"
      >
        {style && (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 pb-2.5 pt-3">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: style.color }} />
              <div className="min-w-0 flex-1">
                <SheetTitle className="truncate text-base font-black tracking-tight" style={{ color: style.color }}>
                  {style.title} <span className="text-sm font-semibold tabular-nums text-muted-foreground">{tasks.length}</span>
                </SheetTitle>
                <SheetDescription className="truncate text-[11px]">
                  {style.subtitle} · {board === "mine" ? "My tasks" : "Team"}
                </SheetDescription>
              </div>
              <QuadrantCustomizer style={style} onChange={onCustomize} onReset={onResetStyle} />
              <Button variant="ghost" className="h-9 px-2.5 text-sm font-semibold text-primary hover:text-primary" onClick={onClose}>
                Done
              </Button>
            </div>
            <div className="shrink-0 border-b border-border px-3 py-1.5">
              <div className="flex items-center gap-1.5">
                <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
                  placeholder={`Add to ${style.title}…`}
                  enterKeyHint="done"
                  className="h-9 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))]">
              {tasks.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">Nothing here.</div>
              ) : (
                <ul className="divide-y divide-border">
                  {tasks.map((t) => <TaskRowItem key={t.id} task={t} showQuadrant={false} {...rowProps} />)}
                </ul>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function QuadrantCustomizer({ style, onChange, onReset }: { style: QuadStyle; onChange: (p: Partial<QuadStyle>) => void; onReset: () => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Customize quadrant">
          <Settings2 className="h-4 w-4" />
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

// ---------------------------------------------------------------- task detail

/** A task opened in full: edit title and notes, category, who it's for, who sees it. */
function TaskDetailSheet({
  task, quadStyles, teamMembers, me, nameOf, onClose, onPatch, onComplete, onDelete, onShare, onMakePrivate,
}: {
  task: TaskRow | null;
  quadStyles: Record<TaskQuadrant, QuadStyle>;
  teamMembers: TeamMember[];
  me: string | null;
  nameOf: (t: Pick<TaskRow, "assigned_to" | "assignee_name">) => string | null;
  onClose: () => void;
  onPatch: (t: TaskRow, patch: Partial<TaskRow>) => void;
  onComplete: (t: TaskRow, done: boolean) => void;
  onDelete: (t: TaskRow) => void;
  onShare: (t: TaskRow, m: TeamMember | null) => void;
  onMakePrivate: (t: TaskRow) => void;
}) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const openId = task?.id ?? null;
  // Reset drafts only when a different task opens, so realtime refreshes never wipe typing.
  useEffect(() => {
    setTitle(task?.title ?? "");
    setNotes(task?.notes ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  const commitText = () => {
    if (!task) return;
    const patch: Partial<TaskRow> = {};
    const t = title.trim();
    if (t && t !== task.title) patch.title = t;
    const n = notes.trim() ? notes : null;
    if ((n ?? null) !== (task.notes ?? null)) patch.notes = n;
    if (Object.keys(patch).length) onPatch(task, patch);
  };
  const close = () => { commitText(); onClose(); };

  const isDone = task?.status === "done";
  const personal = !!task?.owner_user_id;
  const assignedName = task ? nameOf(task) : null;

  return (
    <Sheet open={!!task} onOpenChange={(o) => !o && close()}>
      <SheetContent
        side="bottom"
        hideCloseButton
        className="flex max-h-[92dvh] flex-col gap-0 rounded-t-2xl p-0 md:inset-x-0 md:bottom-6 md:mx-auto md:max-w-xl md:rounded-2xl md:border"
      >
        {task && (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 pb-2 pt-3">
              <SheetTitle className="flex-1 truncate text-sm font-bold text-muted-foreground">
                {personal ? <span className="inline-flex items-center gap-1"><Lock className="h-3.5 w-3.5" />My task · only you</span>
                  : <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />Team task{assignedName ? ` · ${task.assigned_to === me ? "Me" : firstName(assignedName)}` : ""}</span>}
              </SheetTitle>
              <SheetDescription className="sr-only">Edit this task</SheetDescription>
              <Button variant="ghost" className="h-9 px-2.5 text-sm font-semibold text-primary hover:text-primary" onClick={close}>
                Done
              </Button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-4 pt-3">
              <div className="flex items-start gap-2.5">
                <Checkbox
                  checked={isDone}
                  onCheckedChange={(v) => onComplete(task, !!v)}
                  className="mt-1.5 h-5 w-5"
                  aria-label={isDone ? "Mark open" : "Complete task"}
                />
                <AutoGrowTextarea
                  value={title}
                  onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
                  onBlur={commitText}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }}
                  rows={1}
                  maxHeight={140}
                  placeholder="Task"
                  className={cn("min-h-0 flex-1 resize-none border-0 bg-transparent p-0 text-lg font-bold leading-snug shadow-none focus-visible:ring-0", isDone && "text-muted-foreground line-through")}
                />
              </div>

              <AutoGrowTextarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={commitText}
                rows={3}
                maxHeight={320}
                placeholder="Notes"
                className="min-h-[84px] resize-none rounded-lg bg-muted/40 text-[15px] leading-6"
              />

              <div className="space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Category</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {QUADRANTS.map((q) => {
                    const st = quadStyles[q.key];
                    const on = task.quadrant === q.key;
                    return (
                      <button
                        key={q.key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => !on && onPatch(task, { quadrant: q.key })}
                        className="min-h-10 rounded-md border px-1.5 text-xs font-bold"
                        style={{
                          color: st.color,
                          borderColor: on ? st.color : `color-mix(in srgb, ${st.color} 40%, transparent)`,
                          backgroundColor: `color-mix(in srgb, ${st.color} ${on ? 24 : 8}%, transparent)`,
                          boxShadow: on ? `inset 0 0 0 1px ${st.color}` : undefined,
                        }}
                      >
                        {st.title}
                      </button>
                    );
                  })}
                </div>
              </div>

              {personal ? (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Send to team</div>
                  <div className="flex flex-wrap gap-1.5">
                    {[null, ...teamMembers].map((m) => (
                      <button
                        key={m?.user_id ?? "none"}
                        type="button"
                        onClick={() => onShare(task, m)}
                        className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
                      >
                        {m ? (m.user_id === me ? "Me" : firstName(m.full_name)) : "Team (unassigned)"}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">Only you can see this until you send it.</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Assigned to</div>
                  <div className="flex flex-wrap gap-1.5">
                    {[null, ...teamMembers].map((m) => {
                      const on = (task.assigned_to ?? null) === (m?.user_id ?? null);
                      return (
                        <button
                          key={m?.user_id ?? "none"}
                          type="button"
                          aria-pressed={on}
                          onClick={() => !on && onPatch(task, { assigned_to: m?.user_id ?? null, assignee_name: m?.full_name ?? null })}
                          className={cn(
                            "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                            on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {m ? (m.user_id === me ? "Me" : firstName(m.full_name)) : "Unassigned"}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => onMakePrivate(task)}
                    className="inline-flex items-center gap-1 pt-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
                  >
                    <Lock className="h-3 w-3" />Make it my private task
                  </button>
                </div>
              )}

              <p className="text-[11px] text-muted-foreground">
                Added {new Date(task.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                {isDone && task.completed_at ? ` · Done ${new Date(task.completed_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5">
              <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => onDelete(task)}>
                <Trash2 className="mr-1.5 h-4 w-4" />Delete
              </Button>
              <Button className="ml-auto" variant={isDone ? "outline" : "default"} onClick={() => { commitText(); onComplete(task, !isDone); if (!isDone) onClose(); }}>
                {isDone ? <><RotateCcw className="mr-1.5 h-4 w-4" />Reopen</> : <><Check className="mr-1.5 h-4 w-4" />Complete</>}
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
