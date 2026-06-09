import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

export type BroadcastType =
  | "Message"
  | "Quote"
  | "Voice Message"
  | "Video"
  | "Reminder"
  | "Update"
  | "Link";

export type BroadcastStatus = "Draft" | "Scheduled" | "Active" | "Archived";

export type BroadcastAudience =
  | "everyone"
  | "coaching_clients"
  | "app_members"
  | "program_members"
  | "selected_clients";

export type Broadcast = {
  id: string;
  title: string;
  type: BroadcastType;
  body: string;
  voice_path: string | null;
  voice_url: string | null;
  transcript: string | null;
  video_url: string | null;
  video_path: string | null;
  link_url: string | null;
  link_label: string | null;
  audience_scope: BroadcastAudience;
  publish_at: string;
  expires_at: string | null;
  status: BroadcastStatus;
  author_id: string | null;
  created_at: string;
  updated_at: string;
};

export const BROADCAST_AUDIENCE_LABELS: Record<BroadcastAudience, string> = {
  everyone: "Everyone",
  coaching_clients: "All Active Coaching Clients",
  app_members: "App Members",
  program_members: "Program-Only Members",
  selected_clients: "Selected Clients",
};

export const BROADCAST_TYPES: BroadcastType[] = [
  "Message",
  "Quote",
  "Voice Message",
  "Video",
  "Reminder",
  "Update",
  "Link",
];

const SESSION_KEY = "broadcast-popup:session-dismissed";
function sessionDismissed(): Set<string> {
  if (typeof sessionStorage === "undefined") return new Set();
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SESSION_KEY) || "[]"));
  } catch {
    return new Set();
  }
}
export function dismissBroadcastForNow(id: string) {
  const s = sessionDismissed();
  s.add(id);
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(Array.from(s)));
  } catch {}
}

/** Status derived from time + base status. */
export function effectiveStatus(b: Pick<Broadcast, "status" | "publish_at" | "expires_at">): BroadcastStatus {
  if (b.status === "Draft" || b.status === "Archived") return b.status;
  const now = Date.now();
  if (b.expires_at && new Date(b.expires_at).getTime() < now) return "Archived";
  if (new Date(b.publish_at).getTime() > now) return "Scheduled";
  return "Active";
}

export async function listBroadcastsAdmin() {
  const { data, error } = await db.from("broadcasts").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Broadcast[];
}

export async function getBroadcast(id: string) {
  const { data, error } = await db.from("broadcasts").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as Broadcast | null;
}

export async function createBroadcast(input: Partial<Broadcast> & { title: string; type: BroadcastType; authorId?: string }) {
  const { data, error } = await db
    .from("broadcasts")
    .insert({
      title: input.title,
      type: input.type,
      body: input.body ?? "",
      voice_path: input.voice_path ?? null,
      voice_url: input.voice_url ?? null,
      transcript: input.transcript ?? null,
      video_url: input.video_url ?? null,
      video_path: input.video_path ?? null,
      link_url: input.link_url ?? null,
      link_label: input.link_label ?? null,
      audience_scope: input.audience_scope ?? "everyone",
      publish_at: input.publish_at ?? new Date().toISOString(),
      expires_at: input.expires_at ?? null,
      status: input.status ?? "Active",
      author_id: input.authorId ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Broadcast;
}

export async function updateBroadcast(id: string, patch: Partial<Broadcast>) {
  const { data, error } = await db.from("broadcasts").update(patch).eq("id", id).select().single();
  if (error) throw error;
  return data as Broadcast;
}

export async function deleteBroadcast(id: string) {
  const { error } = await db.from("broadcasts").delete().eq("id", id);
  if (error) throw error;
}

export async function setBroadcastSelectedClients(broadcastId: string, clientIds: string[]) {
  await db.from("broadcast_recipients").delete().eq("broadcast_id", broadcastId);
  if (!clientIds.length) return;
  const rows = clientIds.map((cid) => ({ broadcast_id: broadcastId, client_id: cid }));
  const { error } = await db.from("broadcast_recipients").insert(rows);
  if (error) throw error;
}

export async function getBroadcastSelectedClients(broadcastId: string): Promise<string[]> {
  const { data, error } = await db.from("broadcast_recipients").select("client_id").eq("broadcast_id", broadcastId);
  if (error) throw error;
  return (data ?? []).map((r: any) => r.client_id as string);
}

/* Seen */

export async function listActiveBroadcastsForUser(userId: string): Promise<Broadcast[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("broadcasts")
    .select("*")
    .eq("status", "Active")
    .lte("publish_at", nowIso)
    .order("publish_at", { ascending: false });
  if (error) throw error;
  // RLS already restricts to broadcasts the user is in audience of.
  // Filter out expired and seen.
  const all = (data ?? []) as Broadcast[];
  const filtered = all.filter((b) => !b.expires_at || new Date(b.expires_at).getTime() > Date.now());
  if (!filtered.length) return [];

  const { data: seen } = await db
    .from("broadcast_seen")
    .select("broadcast_id")
    .eq("user_id", userId);
  const seenIds = new Set((seen ?? []).map((r: any) => r.broadcast_id));
  const dismissed = sessionDismissed();
  return filtered.filter((b) => !seenIds.has(b.id) && !dismissed.has(b.id));
}

export async function listHistoryBroadcastsForUser(): Promise<Broadcast[]> {
  // RLS scopes to broadcasts user can see (any status).
  const { data, error } = await db
    .from("broadcasts")
    .select("*")
    .in("status", ["Active", "Archived"])
    .order("publish_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Broadcast[];
}

export async function listSeenIdsForUser(userId: string): Promise<Set<string>> {
  const { data } = await db.from("broadcast_seen").select("broadcast_id").eq("user_id", userId);
  return new Set((data ?? []).map((r: any) => r.broadcast_id));
}

export async function markBroadcastGotIt(broadcastId: string, userId: string) {
  const { error } = await db
    .from("broadcast_seen")
    .upsert(
      { broadcast_id: broadcastId, user_id: userId, got_it_at: new Date().toISOString() },
      { onConflict: "broadcast_id,user_id" },
    );
  if (error) throw error;
}

export async function getBroadcastSeenList(broadcastId: string) {
  const { data, error } = await db
    .from("broadcast_seen")
    .select("user_id, got_it_at")
    .eq("broadcast_id", broadcastId)
    .order("got_it_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as { user_id: string; got_it_at: string }[];
}

/* Storage */

export async function uploadBroadcastFile(file: File, kind: "voice" | "video") {
  const ext = file.name.split(".").pop() ?? "bin";
  const path = `${kind}/${crypto.randomUUID()}.${ext}`;
  const { error } = await (supabase as any).storage
    .from("broadcast-media")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return path;
}

export async function getBroadcastFileSignedUrl(path: string, expiresInSeconds = 3600) {
  const { data, error } = await (supabase as any).storage
    .from("broadcast-media")
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl as string;
}

export function statusTone(s: BroadcastStatus) {
  if (s === "Active") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (s === "Scheduled") return "bg-blue-500/15 text-blue-300 border-blue-500/30";
  if (s === "Archived") return "bg-muted text-muted-foreground border-border";
  return "bg-amber-500/15 text-amber-300 border-amber-500/30";
}