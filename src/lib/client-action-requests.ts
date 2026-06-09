import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

export type ClientActionRequest = {
  id: string;
  client_id: string;
  coach_user_id: string;
  title: string;
  message: string;
  native_form_id: string | null;
  external_form_url: string | null;
  link_url: string | null;
  link_label: string | null;
  file_path: string | null;
  file_name: string | null;
  file_mime: string | null;
  priority: string | null;
  internal_notes: string | null;
  notify_client: boolean;
  due_date: string | null;
  seen_at: string | null;
  completed_at: string | null;
  dismissed_at: string | null;
  created_at: string;
  updated_at: string;
};

const SESSION_KEY = "client-action-requests:session-dismissed";
function getSessionDismissed(): Set<string> {
  if (typeof sessionStorage === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export async function createClientActionRequest(input: {
  clientId: string;
  coachUserId: string;
  title: string;
  message: string;
  nativeFormId?: string | null;
  externalFormUrl?: string | null;
  linkUrl?: string | null;
  linkLabel?: string | null;
  filePath?: string | null;
  fileName?: string | null;
  fileMime?: string | null;
  priority?: string | null;
  internalNotes?: string | null;
  dueDate?: string | null;
  notifyClient?: boolean;
}) {
  const { data, error } = await db
    .from("client_action_requests")
    .insert({
      client_id: input.clientId,
      coach_user_id: input.coachUserId,
      title: input.title,
      message: input.message,
      native_form_id: input.nativeFormId ?? null,
      external_form_url: input.externalFormUrl ?? null,
      link_url: input.linkUrl ?? null,
      link_label: input.linkLabel ?? null,
      file_path: input.filePath ?? null,
      file_name: input.fileName ?? null,
      file_mime: input.fileMime ?? null,
      priority: input.priority ?? null,
      internal_notes: input.internalNotes ?? null,
      due_date: input.dueDate ?? null,
      notify_client: input.notifyClient ?? true,
    })
    .select()
    .single();
  if (error) throw error;
  return data as ClientActionRequest;
}

export async function listAllClientActionRequests() {
  const { data, error } = await db
    .from("client_action_requests")
    .select("*, client:clients(id, full_name, email), native_form:nf_forms(id, title)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as (ClientActionRequest & {
    client: { id: string; full_name: string | null; email: string | null } | null;
    native_form: { id: string; title: string } | null;
  })[];
}

export async function listOpenForClientUser(clientId: string) {
  const { data, error } = await db
    .from("client_action_requests")
    .select("*, native_form:nf_forms(id, title)")
    .eq("client_id", clientId)
    .is("completed_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const suppressed = getSessionDismissed();
  return ((data ?? []) as (ClientActionRequest & { native_form: { id: string; title: string } | null })[])
    .filter((r) => !suppressed.has(r.id));
}

export async function listForClient(clientId: string) {
  const { data, error } = await db
    .from("client_action_requests")
    .select("*, native_form:nf_forms(id, title)")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as (ClientActionRequest & { native_form: { id: string; title: string } | null })[];
}

export async function markActionSeen(id: string) {
  await db.from("client_action_requests").update({ seen_at: new Date().toISOString() }).eq("id", id).is("seen_at", null);
}

export async function markActionCompleted(id: string) {
  const { error } = await db
    .from("client_action_requests")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function resendClientActionRequest(id: string) {
  const { error } = await db
    .from("client_action_requests")
    .update({
      completed_at: null,
      seen_at: null,
      dismissed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

/** Suppress for this browser session only — pops back up on next app open. */
export function dismissActionForNow(id: string) {
  const set = getSessionDismissed();
  set.add(id);
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(Array.from(set)));
  } catch {}
}

export async function deleteClientActionRequest(id: string) {
  const { error } = await db.from("client_action_requests").delete().eq("id", id);
  if (error) throw error;
}

export async function getFileSignedUrl(path: string, expiresInSeconds = 600) {
  const { data, error } = await (supabase as any).storage
    .from("client-action-files")
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl as string;
}

export async function uploadActionFile(clientId: string, file: File) {
  const ext = file.name.split(".").pop() ?? "bin";
  const path = `${clientId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await (supabase as any).storage
    .from("client-action-files")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return { path, name: file.name, mime: file.type };
}

export function actionStatus(r: Pick<ClientActionRequest, "completed_at" | "seen_at">) {
  if (r.completed_at)
    return { label: "Completed", tone: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" } as const;
  if (r.seen_at)
    return { label: "Viewed · Not Done", tone: "bg-amber-500/15 text-amber-300 border-amber-500/30" } as const;
  return { label: "Sent · Unseen", tone: "bg-blue-500/15 text-blue-300 border-blue-500/30" } as const;
}

export function actionKindLabel(r: ClientActionRequest) {
  const kinds: string[] = [];
  if (r.native_form_id) kinds.push("Form");
  if (r.external_form_url) kinds.push("External Form");
  if (r.link_url) kinds.push("Link");
  if (r.file_path) kinds.push("File");
  return kinds.length ? kinds.join(" · ") : "Action";
}