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
  assignee_name: string | null;
  completed_at: string | null;
  completed_by: string | null;
  position: number;
  scope: TaskScope;
  /** Set ⇒ a personal task, private to this user. Null ⇒ on the shared team board. */
  owner_user_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Someone a team task can be assigned to (auth user id + display name). */
export type TeamMember = { user_id: string; full_name: string };

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

/** Inserts a task and resolves to its id. */
export type NewTask = {
  title: string; quadrant?: TaskQuadrant; assigned_to?: string | null; assignee_name?: string | null;
  due_at?: string | null; notes?: string | null; scope?: TaskScope;
  /** Pass the caller's user id for a personal task; omit for the team board. */
  owner_user_id?: string | null;
};

export async function createTask(input: NewTask): Promise<string> {
  const me = await getMyCoachId();
  const { data, error } = await (supabase.from("tasks") as any).insert({
    title: input.title,
    quadrant: input.quadrant ?? "do",
    assigned_to: input.assigned_to ?? null,
    assignee_name: input.assignee_name ?? null,
    due_at: input.due_at ?? null,
    notes: input.notes ?? null,
    scope: input.scope ?? "admin",
    owner_user_id: input.owner_user_id ?? null,
    created_by: me,
  }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

export async function updateTask(id: string, patch: Partial<Pick<TaskRow, "title" | "notes" | "quadrant" | "due_at" | "assigned_to" | "assignee_name" | "priority" | "position" | "owner_user_id">>): Promise<void> {
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

/** Bulk: complete/reopen many tasks in one statement. */
export async function bulkSetTaskStatus(ids: string[], done: boolean): Promise<void> {
  if (!ids.length) return;
  const me = await getMyCoachId();
  const { error } = await (supabase.from("tasks") as any).update({
    status: done ? "done" : "open",
    completed_at: done ? new Date().toISOString() : null,
    completed_by: done ? me : null,
  }).in("id", ids);
  if (error) throw error;
}

/** Bulk: move many tasks to a quadrant in one statement. */
export async function bulkMoveTasks(ids: string[], quadrant: TaskQuadrant): Promise<void> {
  if (!ids.length) return;
  const { error } = await (supabase.from("tasks") as any).update({ quadrant }).in("id", ids);
  if (error) throw error;
}

/** Bulk: assign many team tasks to one teammate (null = unassigned) in one statement. */
export async function bulkAssignTasks(ids: string[], member: TeamMember | null): Promise<void> {
  if (!ids.length) return;
  const { error } = await (supabase.from("tasks") as any)
    .update({ assigned_to: member?.user_id ?? null, assignee_name: member?.full_name ?? null }).in("id", ids);
  if (error) throw error;
}

/** Everyone who works the team board, for assigning. Empty for anyone who doesn't. */
export async function fetchTeamMembers(): Promise<TeamMember[]> {
  const { data, error } = await (supabase as any).rpc("task_team_members");
  if (error) throw error;
  return (data ?? []) as TeamMember[];
}

/** A personal task (private to its owner). */
export const isPersonalTask = (t: Pick<TaskRow, "owner_user_id">) => !!t.owner_user_id;

/**
 * "My tasks": my personal tasks plus team tasks assigned to me.
 * "Team": every task on the shared board.
 */
export function splitTasks<T extends Pick<TaskRow, "owner_user_id" | "assigned_to">>(tasks: T[], me: string | null) {
  const mine: T[] = [];
  const team: T[] = [];
  for (const t of tasks) {
    if (t.owner_user_id) { if (t.owner_user_id === me) mine.push(t); continue; }
    team.push(t);
    if (me && t.assigned_to === me) mine.push(t);
  }
  return { mine, team };
}

/** First name, for compact chips. */
export const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || "";

/** Bulk: delete many tasks in one statement. */
export async function bulkDeleteTasksByIds(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await (supabase.from("tasks") as any).delete().in("id", ids);
  if (error) throw error;
}

export async function fetchCoachesLite(): Promise<{ id: string; full_name: string | null }[]> {
  const { data } = await supabase.from("coaches").select("id, full_name").eq("archived", false).order("full_name");
  return (data ?? []) as any;
}

export function countOpen(tasks: TaskRow[]): number {
  return tasks.filter((t) => t.status === "open").length;
}