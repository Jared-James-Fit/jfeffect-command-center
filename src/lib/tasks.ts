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
  /** The first person on it (kept by the database from `assignees`). */
  assigned_to: string | null;
  assignee_name: string | null;
  /** Everyone on a team task, in the order they were added (logins). Empty on a private task. */
  assignees: string[];
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
  title: string; quadrant?: TaskQuadrant;
  /** Who's on a team task (logins). */
  assignees?: string[];
  due_at?: string | null; notes?: string | null; scope?: TaskScope;
  /** Pass the caller's user id for a personal task; omit for the team board. */
  owner_user_id?: string | null;
};

export async function createTask(input: NewTask): Promise<string> {
  const me = await getMyCoachId();
  const { data, error } = await (supabase.from("tasks") as any).insert({
    title: input.title,
    quadrant: input.quadrant ?? "do",
    assignees: input.owner_user_id ? [] : input.assignees ?? [],
    due_at: input.due_at ?? null,
    notes: input.notes ?? null,
    scope: input.scope ?? "admin",
    owner_user_id: input.owner_user_id ?? null,
    created_by: me,
  }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

export async function updateTask(id: string, patch: Partial<Pick<TaskRow, "title" | "notes" | "quadrant" | "due_at" | "assignees" | "priority" | "position" | "owner_user_id">>): Promise<void> {
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

/** Bulk: put many team tasks on one teammate (null = nobody) in one statement. */
export async function bulkAssignTasks(ids: string[], member: TeamMember | null): Promise<void> {
  if (!ids.length) return;
  const { error } = await (supabase.from("tasks") as any)
    .update({ assignees: member ? [member.user_id] : [] }).in("id", ids);
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

type WithPeople = Pick<TaskRow, "owner_user_id" | "assigned_to"> & { assignees?: string[] | null };

/** Everyone on a team task, in the order they were added (a row from before shared tasks: its one assignee). */
export function taskPeople(t: WithPeople): string[] {
  if (t.owner_user_id) return [];
  if (t.assignees?.length) return [...new Set(t.assignees)];
  return t.assigned_to ? [t.assigned_to] : [];
}

/** The people on a task besides me: what its "shared with" shows. */
export const othersOn = (t: WithPeople, me: string | null) => taskPeople(t).filter((u) => u !== me);

/**
 * Sending a private task to the team: whoever it goes to joins the sender on
 * it (it's shared, so both have it in My tasks); the board alone means nobody yet.
 */
export function sendToTeamPeople(me: string | null, to: string | null): string[] {
  if (!to) return [];
  return [...new Set([me, to].filter((u): u is string => !!u))];
}

/** Add or take someone off a team task, keeping everyone else in order. */
export function togglePerson(people: string[], userId: string): string[] {
  return people.includes(userId) ? people.filter((u) => u !== userId) : [...people, userId];
}

/** Who's newly on a task after a change (they hear about it). */
export const newlyOn = (before: string[], after: string[], me: string | null) =>
  after.filter((u) => u !== me && !before.includes(u));

/**
 * "My tasks": my personal tasks plus team tasks I'm on (shared or assigned).
 * "Team": every task on the shared board.
 */
export function splitTasks<T extends WithPeople>(tasks: T[], me: string | null) {
  const mine: T[] = [];
  const team: T[] = [];
  for (const t of tasks) {
    if (t.owner_user_id) { if (t.owner_user_id === me) mine.push(t); continue; }
    team.push(t);
    if (me && taskPeople(t).includes(me)) mine.push(t);
  }
  return { mine, team };
}

/** "Fionna", "Fionna & Vicky", "Fionna +2": who else a task is shared with, short. */
export function peopleLabel(names: string[]): string {
  const n = names.map((x) => firstName(x)).filter(Boolean);
  if (n.length === 0) return "";
  if (n.length === 1) return n[0];
  if (n.length === 2) return `${n[0]} & ${n[1]}`;
  return `${n[0]} +${n.length - 1}`;
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