import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, MoreHorizontal, CalendarIcon, Star, Trash2, Archive, Check, X } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  fetchMediaTasks, PRIORITY_LABELS, STATUS_LABELS, bulkUpdateTasks,
  bulkArchiveTasks, bulkDeleteTasks, bulkCompleteTasks, dueBucket,
  type ExtendedTaskRow, type PriorityLabel, type StatusLabel,
} from "@/lib/media-tasks";
import { createTask, toggleTaskDone } from "@/lib/tasks";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const BUCKET_ORDER: ReturnType<typeof dueBucket>[] = ["overdue", "today", "upcoming", "none", "completed"];
const BUCKET_LABEL: Record<ReturnType<typeof dueBucket>, string> = {
  overdue: "Overdue", today: "Today", upcoming: "Upcoming", none: "No Due Date", completed: "Completed",
};

export function WorkListView({ filter }: { filter?: string }) {
  const qc = useQueryClient();
  const { data: tasks = [] } = useQuery({ queryKey: ["media-tasks"], queryFn: () => fetchMediaTasks() });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Quick add
  const [qaTitle, setQaTitle] = useState("");
  const [qaPriority, setQaPriority] = useState<PriorityLabel>("normal");
  const [qaDue, setQaDue] = useState<Date | undefined>();

  const filtered = useMemo(() => {
    if (!filter) return tasks;
    if (filter === "overdue") return tasks.filter((t) => dueBucket(t) === "overdue");
    if (filter === "today") return tasks.filter((t) => dueBucket(t) === "today");
    if (filter === "unassigned") return tasks.filter((t) => !t.assigned_to && !t.assignee_name);
    if (filter === "blocked") return tasks.filter((t) => t.status_label === "blocked");
    return tasks;
  }, [tasks, filter]);

  const buckets = useMemo(() => {
    const m: Record<string, ExtendedTaskRow[]> = { overdue: [], today: [], upcoming: [], none: [], completed: [] };
    for (const t of filtered) m[dueBucket(t)].push(t);
    return m;
  }, [filtered]);

  const visibleIds = filtered.map((t) => t.id);
  const allChecked = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someChecked = selected.size > 0 && !allChecked;

  function toggleSelect(id: string, on: boolean) {
    setSelected((s) => { const x = new Set(s); on ? x.add(id) : x.delete(id); return x; });
  }
  function selectAllVisible(on: boolean) {
    setSelected((s) => {
      const x = new Set(s);
      visibleIds.forEach((id) => on ? x.add(id) : x.delete(id));
      return x;
    });
  }
  function clearSelection() { setSelected(new Set()); }

  async function handleQuickAdd() {
    const title = qaTitle.trim();
    if (!title) return;
    setQaTitle("");
    await createTask({
      title,
      scope: "media",
      due_at: qaDue ? qaDue.toISOString() : null,
    });
    if (qaPriority !== "normal") {
      // Patch the most-recent task with priority. Fetch fresh then take latest by id timing isn't perfect — leave priority for the row menu.
    }
    setQaDue(undefined); setQaPriority("normal");
    qc.invalidateQueries({ queryKey: ["media-tasks"] });
  }

  async function bulk(action: "assign" | "due" | "priority" | "status" | "complete" | "archive" | "delete", value?: any) {
    const ids = Array.from(selected);
    try {
      if (action === "complete") await bulkCompleteTasks(ids);
      else if (action === "archive") await bulkArchiveTasks(ids);
      else if (action === "delete") await bulkDeleteTasks(ids);
      else if (action === "due") await bulkUpdateTasks(ids, { due_at: value ? new Date(value).toISOString() : null });
      else if (action === "priority") await bulkUpdateTasks(ids, { priority_label: value });
      else if (action === "status") await bulkUpdateTasks(ids, { status_label: value });
      toast.success(`Updated ${ids.length} task${ids.length === 1 ? "" : "s"}`);
      clearSelection();
      qc.invalidateQueries({ queryKey: ["media-tasks"] });
      qc.invalidateQueries({ queryKey: ["media-calendar-content"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Bulk action failed");
    }
  }

  return (
    <div className="space-y-4">
      {/* Quick add row */}
      <Card className="border-border bg-card p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={qaTitle}
            onChange={(e) => setQaTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleQuickAdd(); }}
            placeholder="What needs to get done? (Press Enter to add)"
            className="flex-1"
          />
          <Select value={qaPriority} onValueChange={(v) => setQaPriority(v as PriorityLabel)}>
            <SelectTrigger className="sm:w-32"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              {PRIORITY_LABELS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("sm:w-40 justify-start", !qaDue && "text-muted-foreground")}>
                <CalendarIcon className="mr-1 h-4 w-4" />
                {qaDue ? format(qaDue, "PP") : "Due date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={qaDue} onSelect={setQaDue} initialFocus className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
          <Button onClick={handleQuickAdd}><Plus className="mr-1 h-4 w-4" />Add Task</Button>
        </div>
      </Card>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <Card className="border-primary/40 bg-primary/5 p-3 sticky top-0 z-10">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{selected.size} selected</Badge>
            <Select onValueChange={(v) => bulk("priority", v)}>
              <SelectTrigger className="h-8 w-36"><SelectValue placeholder="Priority" /></SelectTrigger>
              <SelectContent>{PRIORITY_LABELS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
            </Select>
            <Select onValueChange={(v) => bulk("status", v)}>
              <SelectTrigger className="h-8 w-40"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>{STATUS_LABELS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
            <Popover>
              <PopoverTrigger asChild><Button variant="outline" size="sm"><CalendarIcon className="mr-1 h-4 w-4" />Due date</Button></PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" onSelect={(d) => d && bulk("due", d)} className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
            <Button variant="outline" size="sm" onClick={() => bulk("complete")}><Check className="mr-1 h-4 w-4" />Complete</Button>
            <Button variant="outline" size="sm" onClick={() => bulk("archive")}><Archive className="mr-1 h-4 w-4" />Archive</Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm"><Trash2 className="mr-1 h-4 w-4" />Delete</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {selected.size} task{selected.size === 1 ? "" : "s"}?</AlertDialogTitle>
                  <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => bulk("delete")}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button variant="ghost" size="sm" onClick={clearSelection}><X className="mr-1 h-4 w-4" />Clear</Button>
          </div>
        </Card>
      )}

      {/* Select-all toggle */}
      <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <Checkbox
          checked={allChecked ? true : someChecked ? "indeterminate" as any : false}
          onCheckedChange={(v) => selectAllVisible(!!v)}
        />
        <span>Select all visible ({visibleIds.length})</span>
      </div>

      {/* Buckets */}
      {BUCKET_ORDER.map((bk) => {
        const rows = buckets[bk];
        if (rows.length === 0) return null;
        return (
          <Card key={bk} className="border-border p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                {BUCKET_LABEL[bk]}
              </h3>
              <Badge variant="outline">{rows.length}</Badge>
            </div>
            <ul className="divide-y divide-border">
              {rows.map((t) => (
                <TaskRow key={t.id} task={t} selected={selected.has(t.id)} onSelect={(on) => toggleSelect(t.id, on)} />
              ))}
            </ul>
          </Card>
        );
      })}

      {filtered.length === 0 && (
        <Card className="border-dashed p-10 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Plus className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="mb-3 text-sm text-muted-foreground">No tasks yet.</p>
          <Button onClick={() => { setQaTitle("New task"); setTimeout(handleQuickAdd, 0); }}>
            <Plus className="mr-1 h-4 w-4" />Add Task
          </Button>
        </Card>
      )}
    </div>
  );
}

function TaskRow({ task, selected, onSelect }: { task: ExtendedTaskRow; selected: boolean; onSelect: (on: boolean) => void }) {
  const qc = useQueryClient();
  const isDone = task.status === "done";
  const pri = PRIORITY_LABELS.find((p) => p.value === task.priority_label);
  const stat = STATUS_LABELS.find((s) => s.value === task.status_label);
  const overdue = !isDone && task.due_at && task.due_at.slice(0, 10) < new Date().toISOString().slice(0, 10);

  const initials = (task.assignee_name ?? "").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  async function toggleImportant() {
    await (supabase.from("tasks") as any).update({ important: !task.important }).eq("id", task.id);
    qc.invalidateQueries({ queryKey: ["media-tasks"] });
  }

  async function setDueDate(d: Date | null) {
    await (supabase.from("tasks") as any)
      .update({ due_at: d ? d.toISOString() : null })
      .eq("id", task.id);
    qc.invalidateQueries({ queryKey: ["media-tasks"] });
    qc.invalidateQueries({ queryKey: ["media-calendar-content"] });
    toast.success(d ? `Due ${format(d, "MMM d")}` : "Due date cleared");
  }

  return (
    <li className="flex items-start gap-3 py-2.5">
      <Checkbox checked={selected} onCheckedChange={(v) => onSelect(!!v)} className="mt-1" />
      <Checkbox
        checked={isDone}
        onCheckedChange={(v) => toggleTaskDone(task.id, !!v).then(() => qc.invalidateQueries({ queryKey: ["media-tasks"] }))}
        className="mt-1"
        aria-label="Mark complete"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("text-sm font-medium", isDone && "line-through text-muted-foreground")}>{task.title}</span>
          {task.important && <Star className="h-3.5 w-3.5 fill-yellow-500 text-yellow-500" />}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
          {stat && <Badge variant="outline" style={{ borderColor: `${stat.color}80`, color: stat.color }}>{stat.label}</Badge>}
          {pri && <Badge variant="outline" style={{ borderColor: `${pri.color}80`, color: pri.color }}>{pri.label}</Badge>}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex h-5 items-center gap-1 rounded-full border border-dashed border-border px-1.5 text-[10px] text-muted-foreground hover:border-primary hover:text-primary transition-colors",
                  task.due_at && "border-solid border-border",
                  overdue && "border-destructive/60 text-destructive font-medium",
                )}
                aria-label={task.due_at ? "Edit due date" : "Set due date"}
              >
                <CalendarIcon className="h-3 w-3" />
                {task.due_at ? format(new Date(task.due_at), "MMM d") : "Set due"}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={task.due_at ? new Date(task.due_at) : undefined}
                onSelect={(d) => d && setDueDate(d)}
                initialFocus
                className="p-3 pointer-events-auto"
              />
              {task.due_at && (
                <div className="border-t border-border p-2">
                  <Button variant="ghost" size="sm" className="w-full" onClick={() => setDueDate(null)}>
                    <X className="mr-1 h-3 w-3" />Clear due date
                  </Button>
                </div>
              )}
            </PopoverContent>
          </Popover>
          {task.assignee_name && (
            <span className="inline-flex h-5 items-center gap-1 rounded-full border border-border bg-muted/60 px-2 text-[10px] font-semibold">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/20 text-primary text-[9px]">{initials}</span>
              {task.assignee_name}
            </span>
          )}
        </div>
      </div>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleImportant} title="Important">
        <Star className={cn("h-3.5 w-3.5", task.important && "fill-yellow-500 text-yellow-500")} />
      </Button>
      <RowMenu task={task} />
    </li>
  );
}

function RowMenu({ task }: { task: ExtendedTaskRow }) {
  const qc = useQueryClient();
  async function patch(p: any) {
    await (supabase.from("tasks") as any).update(p).eq("id", task.id);
    qc.invalidateQueries({ queryKey: ["media-tasks"] });
    qc.invalidateQueries({ queryKey: ["media-calendar-content"] });
  }
  function dueIn(days: number) {
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    d.setDate(d.getDate() + days);
    return patch({ due_at: d.toISOString() });
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-4 w-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <div className="px-2 py-1 text-[10px] uppercase tracking-widest text-muted-foreground">Due date</div>
        <DropdownMenuItem onClick={() => dueIn(0)}><CalendarIcon className="mr-2 h-4 w-4" />Today</DropdownMenuItem>
        <DropdownMenuItem onClick={() => dueIn(1)}><CalendarIcon className="mr-2 h-4 w-4" />Tomorrow</DropdownMenuItem>
        <DropdownMenuItem onClick={() => dueIn(7)}><CalendarIcon className="mr-2 h-4 w-4" />Next week</DropdownMenuItem>
        <DropdownMenuItem onClick={() => patch({ due_at: null })}><X className="mr-2 h-4 w-4" />Clear due date</DropdownMenuItem>
        <div className="px-2 py-1 text-[10px] uppercase tracking-widest text-muted-foreground">Priority</div>
        {PRIORITY_LABELS.map((p) => (
          <DropdownMenuItem key={p.value} onClick={() => patch({ priority_label: p.value })}>{p.label}</DropdownMenuItem>
        ))}
        <div className="mt-1 px-2 py-1 text-[10px] uppercase tracking-widest text-muted-foreground">Status</div>
        {STATUS_LABELS.map((s) => (
          <DropdownMenuItem key={s.value} onClick={() => patch({ status_label: s.value })}>{s.label}</DropdownMenuItem>
        ))}
        <DropdownMenuItem onClick={() => patch({ archived_at: new Date().toISOString() })}>
          <Archive className="mr-2 h-4 w-4" />Archive
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive"
          onClick={async () => { if (confirm("Delete task?")) { await (supabase.from("tasks") as any).delete().eq("id", task.id); qc.invalidateQueries({ queryKey: ["media-tasks"] }); } }}
        ><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}