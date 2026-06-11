import { supabase } from "@/integrations/supabase/client";

export type TaskQuadrant = "do" | "schedule" | "delegate" | "eliminate";
export type TaskStatus = "open" | "done";

export interface TaskRow {
  id: string;
  title: string;
  notes: string | null;
  quadrant: TaskQuadrant;
  status: TaskStatus;
  priority: number;
  due_at: string | null;
  created_by: string | null;
  assigned_to: string | null;
  completed_at: string | null;
  completed_by: string | null;
  position: number;
  scope: TaskScope;
  created_at: string;
  updated_at: string;
}

export type TaskScope = "admin" | "media";

export const QUADRANTS: { key: TaskQuadrant; title: string; subtitle: string; tone: string }[] = [
  { key: "do",        title: "Do First",   subtitle: "Urgent · Important",         tone: "border-destructive/50 bg-destructive/5" },
  { key: "schedule",  title: "Schedule",   subtitle: "Important · Not Urgent",     tone: "border-primary/50 bg-primary/5" },
  { key: "delegate",  title: "Delegate",   subtitle: "Urgent · Not Important",     tone: "border-warning/50 bg-warning/5" },
  { key: "eliminate", title: "Eliminate",  subtitle: "Not Urgent · Not Important", tone: "border-muted-foreground/30 bg-muted/30" },
];

export async function fetchTasks(scope: TaskScope = "admin"): Promise<TaskRow[]> {
  const { data, error } = await (supabase.from("tasks") as any)
    .select("*").eq("scope", scope)
    .order("status").order("position").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as TaskRow[];
}

export async function getMyCoachId(): Promise<string | null> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const { data } = await supabase.from("coaches").select("id").eq("user_id", u.user.id).maybeSingle();
  return data?.id ?? null;
}

export async function createTask(input: { title: string; quadrant?: TaskQuadrant; assigned_to?: string | null; due_at?: string | null; notes?: string | null; scope?: TaskScope }): Promise<void> {
  const me = await getMyCoachId();
  const { error } = await (supabase.from("tasks") as any).insert({
    title: input.title,
    quadrant: input.quadrant ?? "do",
    assigned_to: input.assigned_to ?? null,
    due_at: input.due_at ?? null,
    notes: input.notes ?? null,
    scope: input.scope ?? "admin",
    created_by: me,
  });
  if (error) throw error;
}

export async function updateTask(id: string, patch: Partial<Pick<TaskRow, "title" | "notes" | "quadrant" | "due_at" | "assigned_to" | "priority" | "position">>): Promise<void> {
  const { error } = await (supabase.from("tasks") as any).update(patch).eq("id", id);
  if (error) throw error;
}

export async function toggleTaskDone(id: string, done: boolean): Promise<void> {
  const me = await getMyCoachId();
  const { error } = await (supabase.from("tasks") as any).update({
    status: done ? "done" : "open",
    completed_at: done ? new Date().toISOString() : null,
    completed_by: done ? me : null,
  }).eq("id", id);
  if (error) throw error;
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await (supabase.from("tasks") as any).delete().eq("id", id);
  if (error) throw error;
}

export async function fetchCoachesLite(): Promise<{ id: string; full_name: string | null }[]> {
  const { data } = await supabase.from("coaches").select("id, full_name").eq("archived", false).order("full_name");
  return (data ?? []) as any;
}

export function countOpen(tasks: TaskRow[]): number {
  return tasks.filter((t) => t.status === "open").length;
}