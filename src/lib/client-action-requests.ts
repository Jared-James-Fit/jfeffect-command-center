import { supabase } from "@/integrations/supabase/client";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

// ---------------------------------------------------------------------------
// Protected server-side mutations.
//
// All writes to client_action_requests must go through these handlers. They
// authenticate via requireSupabaseAuth, authorize the caller as admin or the
// assigned coach for the *stored* client, and derive coach_user_id from the
// session (never from caller input).
// ---------------------------------------------------------------------------
async function isAdmin(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  return !!data;
}

async function isAssignedCoachOfClient(supabase: any, userId: string, clientId: string): Promise<boolean> {
  // Mirror is_assigned_coach() SQL helper at the application layer (RLS still
  // enforces server-side). Returns true if userId is the active assigned
  // coach for clientId.
  const { data } = await supabase
    .from("clients").select("id, assigned_coach_id, coach:coaches!clients_assigned_coach_id_fkey(user_id, archived, status)")
    .eq("id", clientId).maybeSingle();
  const coach = (data as any)?.coach;
  return !!coach && coach.user_id === userId && coach.archived === false && coach.status === "Active";
}

async function assertCanManageClient(supabase: any, userId: string, clientId: string) {
  if (await isAdmin(supabase, userId)) return;
  if (await isAssignedCoachOfClient(supabase, userId, clientId)) return;
  throw new Error("Forbidden: not admin or assigned coach for this client");
}

const createInput = z.object({
  clientId: z.string().uuid(),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(5000),
  nativeFormId: z.string().uuid().nullable().optional(),
  externalFormUrl: z.string().url().max(2000).nullable().optional(),
  linkUrl: z.string().url().max(2000).nullable().optional(),
  linkLabel: z.string().max(200).nullable().optional(),
  filePath: z.string().max(500).nullable().optional(),
  fileName: z.string().max(300).nullable().optional(),
  fileMime: z.string().max(200).nullable().optional(),
  priority: z.string().max(50).nullable().optional(),
  internalNotes: z.string().max(5000).nullable().optional(),
  dueDate: z.string().nullable().optional(),
  notifyClient: z.boolean().optional(),
});

export const createClientActionRequestFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => createInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Verify the client exists, and authorize caller against the *stored* client.
    const { data: client, error: clientErr } = await supabase
      .from("clients").select("id").eq("id", data.clientId).maybeSingle();
    if (clientErr) throw new Error(clientErr.message);
    if (!client) throw new Error("Client not found");
    await assertCanManageClient(supabase, userId, data.clientId);

    const { data: row, error } = await supabase
      .from("client_action_requests")
      .insert({
        client_id: data.clientId,
        coach_user_id: userId, // derived from session, never trusted from client
        title: data.title,
        message: data.message,
        native_form_id: data.nativeFormId ?? null,
        external_form_url: data.externalFormUrl ?? null,
        link_url: data.linkUrl ?? null,
        link_label: data.linkLabel ?? null,
        file_path: data.filePath ?? null,
        file_name: data.fileName ?? null,
        file_mime: data.fileMime ?? null,
        priority: data.priority ?? null,
        internal_notes: data.internalNotes ?? null,
        due_date: data.dueDate ?? null,
        notify_client: data.notifyClient ?? true,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row as ClientActionRequest;
  });

export const deleteClientActionRequestFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Load existing row so authorization uses *stored* client_id, not input.
    const { data: existing, error: loadErr } = await supabase
      .from("client_action_requests").select("id, client_id, file_path").eq("id", data.id).maybeSingle();
    if (loadErr) throw new Error(loadErr.message);
    if (!existing) throw new Error("Request not found");
    await assertCanManageClient(supabase, userId, existing.client_id);

    // Best-effort file cleanup through the same authorized session (storage RLS
    // still applies). Failures here must not block the row delete.
    if (existing.file_path) {
      try { await supabase.storage.from("client-action-files").remove([existing.file_path]); } catch {}
    }

    const { error } = await supabase.from("client_action_requests").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resendClientActionRequestFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing, error: loadErr } = await supabase
      .from("client_action_requests").select("id, client_id").eq("id", data.id).maybeSingle();
    if (loadErr) throw new Error(loadErr.message);
    if (!existing) throw new Error("Request not found");
    await assertCanManageClient(supabase, userId, existing.client_id);

    // Reset visibility flags only — never touch client_id, coach_user_id, or other ownership fields.
    const { error } = await supabase
      .from("client_action_requests")
      .update({
        completed_at: null,
        seen_at: null,
        dismissed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Browser-facing wrappers — invoke the protected server fns above.
// Older signatures preserved so existing call sites compile unchanged.
// `coachUserId` is accepted for backward compatibility but ignored: the
// authoritative creator is derived from the authenticated session server-side.
// ---------------------------------------------------------------------------
export async function createClientActionRequest(input: {
  clientId: string;
  coachUserId?: string; // ignored — server derives from session
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
  return await createClientActionRequestFn({
    data: {
      clientId: input.clientId,
      title: input.title,
      message: input.message,
      nativeFormId: input.nativeFormId ?? null,
      externalFormUrl: input.externalFormUrl ?? null,
      linkUrl: input.linkUrl ?? null,
      linkLabel: input.linkLabel ?? null,
      filePath: input.filePath ?? null,
      fileName: input.fileName ?? null,
      fileMime: input.fileMime ?? null,
      priority: input.priority ?? null,
      internalNotes: input.internalNotes ?? null,
      dueDate: input.dueDate ?? null,
      notifyClient: input.notifyClient ?? true,
    },
  });
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
  await resendClientActionRequestFn({ data: { id } });
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
  await deleteClientActionRequestFn({ data: { id } });
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