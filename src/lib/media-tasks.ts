import { supabase } from "@/integrations/supabase/client";
import type { TaskRow } from "@/lib/tasks";

export type PriorityLabel = "urgent" | "high" | "normal" | "low";
export type StatusLabel = "not_started" | "in_progress" | "waiting" | "blocked" | "complete";

export const PRIORITY_LABELS: { value: PriorityLabel; label: string; color: string }[] = [
  { value: "urgent", label: "Urgent", color: "#ef4444" },
  { value: "high",   label: "High",   color: "#f97316" },
  { value: "normal", label: "Normal", color: "#3b82f6" },
  { value: "low",    label: "Low",    color: "#6b7280" },
];

export const STATUS_LABELS: { value: StatusLabel; label: string; color: string }[] = [
  { value: "not_started", label: "Not Started", color: "#6b7280" },
  { value: "in_progress", label: "In Progress", color: "#3b82f6" },
  { value: "waiting",     label: "Waiting",     color: "#a855f7" },
  { value: "blocked",     label: "Blocked",     color: "#ef4444" },
  { value: "complete",    label: "Complete",    color: "#22c55e" },
];

export interface ExtendedTaskRow extends TaskRow {
  due_time: string | null;
  important: boolean;
  priority_label: PriorityLabel | null;
  status_label: StatusLabel | null;
  campaign_id: string | null;
  linked_content_id: string | null;
  linked_asset_id: string | null;
  recurring_rule: any | null;
  archived_at: string | null;
  description: string | null;
}

export async function fetchMediaTasks(opts: { includeArchived?: boolean } = {}): Promise<ExtendedTaskRow[]> {
  let q = (supabase.from("tasks") as any)
    .select("*").eq("scope", "media")
    .order("status").order("position").order("created_at", { ascending: false });
  if (!opts.includeArchived) q = q.is("archived_at", null);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ExtendedTaskRow[];
}

export async function bulkUpdateTasks(ids: string[], patch: Record<string, any>) {
  if (!ids.length) return;
  const { error } = await (supabase.from("tasks") as any).update(patch).in("id", ids);
  if (error) throw error;
}

export async function bulkDeleteTasks(ids: string[]) {
  if (!ids.length) return;
  const { error } = await (supabase.from("tasks") as any).delete().in("id", ids);
  if (error) throw error;
}

export async function bulkArchiveTasks(ids: string[]) {
  return bulkUpdateTasks(ids, { archived_at: new Date().toISOString() });
}

export async function bulkCompleteTasks(ids: string[]) {
  return bulkUpdateTasks(ids, {
    status: "done",
    status_label: "complete",
    completed_at: new Date().toISOString(),
  });
}

export function dueBucket(t: ExtendedTaskRow): "overdue" | "today" | "upcoming" | "none" | "completed" {
  if (t.status === "done" || t.status_label === "complete") return "completed";
  if (!t.due_at) return "none";
  const today = new Date().toISOString().slice(0, 10);
  const due = t.due_at.slice(0, 10);
  if (due < today) return "overdue";
  if (due === today) return "today";
  return "upcoming";
}