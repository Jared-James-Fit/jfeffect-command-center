import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, MoreHorizontal, Trash2, ListChecks } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  QUADRANTS, fetchTasks, fetchCoachesLite, createTask, toggleTaskDone,
  updateTask, deleteTask, type TaskRow, type TaskQuadrant,
} from "@/lib/tasks";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/tasks")({ component: TasksPage });

function TasksPage() {
  const qc = useQueryClient();
  const { data: tasks = [] } = useQuery({ queryKey: ["tasks"], queryFn: fetchTasks });
  const { data: coaches = [] } = useQuery({ queryKey: ["coaches-lite"], queryFn: fetchCoachesLite });

  // realtime live updates
  useEffect(() => {
    const ch = supabase.channel("tasks-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => {
        qc.invalidateQueries({ queryKey: ["tasks"] });
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

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
    await createTask({ title, quadrant: newQuadrant });
    qc.invalidateQueries({ queryKey: ["tasks"] });
  }

  return (
    <>
      <PageHeader title="Task Manager" subtitle="Collaborate on what needs to get done." />
      <div className="space-y-5 p-4 pb-32 md:p-6 md:pb-8">
        {/* QUICK ADD */}
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
                {QUADRANTS.map((q) => <SelectItem key={q.key} value={q.key}>{q.title}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={handleAdd}><Plus className="mr-1 h-4 w-4" />Add</Button>
          </div>
        </Card>

        {/* CHECKLIST */}
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
                <TaskListRow key={t.id} task={t} coaches={coaches} coachName={coachName} />
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
                  <TaskListRow key={t.id} task={t} coaches={coaches} coachName={coachName} />
                ))}
              </ul>
            </details>
          )}
        </Card>

        {/* EISENHOWER MATRIX */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Eisenhower Matrix</h2>
            <span className="text-[11px] text-muted-foreground">Reassign with the menu on each task.</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {QUADRANTS.map((q) => (
              <Card key={q.key} className={cn("border p-4 transition-shadow hover:shadow-md", q.tone)}>
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-black tracking-tight">{q.title}</div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{q.subtitle}</div>
                  </div>
                  <Badge variant="outline">{byQuadrant[q.key].length}</Badge>
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
                        <TaskRowMenu task={t} coaches={coaches} />
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

function TaskListRow({ task, coaches, coachName }: { task: TaskRow; coaches: { id: string; full_name: string | null }[]; coachName: (id: string | null) => string | null }) {
  const isDone = task.status === "done";
  return (
    <li className="flex items-start gap-3 py-2.5">
      <Checkbox checked={isDone} onCheckedChange={(v) => toggleTaskDone(task.id, !!v)} className="mt-1" />
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm font-medium", isDone && "line-through text-muted-foreground")}>{task.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          <Badge variant="outline" className="text-[9px]">{QUADRANTS.find((q) => q.key === task.quadrant)?.title}</Badge>
          {coachName(task.assigned_to) && <span>→ {coachName(task.assigned_to)}</span>}
        </div>
      </div>
      <TaskRowMenu task={task} coaches={coaches} />
    </li>
  );
}

function TaskRowMenu({ task, coaches }: { task: TaskRow; coaches: { id: string; full_name: string | null }[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"><MoreHorizontal className="h-4 w-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1 text-[10px] uppercase tracking-widest text-muted-foreground">Move to</div>
        {QUADRANTS.map((q) => (
          <DropdownMenuItem key={q.key} disabled={q.key === task.quadrant} onClick={() => updateTask(task.id, { quadrant: q.key })}>
            {q.title}
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