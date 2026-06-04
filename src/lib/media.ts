import { supabase } from "@/integrations/supabase/client";

export const MEDIA_TYPES = [
  "Lift Videos",
  "Check-In Videos",
  "Progress Photos",
  "Training Videos",
  "Form Videos",
  "Technique Videos",
  "Documents",
  "Other Media",
] as const;
export type MediaType = typeof MEDIA_TYPES[number];

export const CLIENT_MEDIA_TYPES: MediaType[] = ["Lift Videos", "Check-In Videos", "Progress Photos", "Other Media"];

export const MEDIA_STATUSES = ["Pending Review", "In Review", "Reviewed", "Needs Follow-Up", "Archived"] as const;
export type MediaStatus = typeof MEDIA_STATUSES[number];

export const COMMENT_TYPES = [
  "Technique",
  "Praise",
  "Correction",
  "Programming Note",
  "Question",
  "Follow-Up Needed",
  "Pain / Discomfort",
  "General",
  "Custom",
] as const;
export type CommentType = typeof COMMENT_TYPES[number];

export function statusTone(status: string) {
  switch (status) {
    case "Pending Review": return "border-amber-500/40 bg-amber-500/10 text-amber-300";
    case "In Review":      return "border-blue-500/40 bg-blue-500/10 text-blue-300";
    case "Reviewed":       return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    case "Needs Follow-Up":return "border-rose-500/40 bg-rose-500/10 text-rose-300";
    case "Archived":       return "border-muted bg-muted/30 text-muted-foreground";
    default:               return "border-border bg-muted/30 text-muted-foreground";
  }
}

export function fmtTimestamp(secs: number | null | undefined) {
  if (secs == null || isNaN(secs)) return "";
  const s = Math.max(0, Math.floor(secs));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export async function listMediaItems(opts: { clientId?: string; status?: MediaStatus | "all"; type?: MediaType | "all"; urgentOnly?: boolean } = {}) {
  let q = supabase.from("media_items" as any).select("*").order("created_at", { ascending: false });
  if (opts.clientId) q = q.eq("client_id", opts.clientId);
  if (opts.status && opts.status !== "all") q = q.eq("status", opts.status);
  if (opts.type && opts.type !== "all") q = q.eq("media_type", opts.type);
  if (opts.urgentOnly) q = q.eq("urgent_flag", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as any[];
}

export async function listMediaComments(mediaItemId: string) {
  const { data, error } = await supabase
    .from("media_comments" as any)
    .select("*")
    .eq("media_item_id", mediaItemId)
    .order("video_timestamp_seconds", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as any[];
}

export async function addComment(input: {
  mediaItemId: string;
  clientId: string;
  authorId: string;
  authorRole: "admin" | "client";
  body: string;
  timestampSeconds?: number | null;
  commentType?: string;
  isInternal?: boolean;
}) {
  const { data, error } = await supabase.from("media_comments" as any).insert({
    media_item_id: input.mediaItemId,
    client_id: input.clientId,
    author_id: input.authorId,
    author_role: input.authorRole,
    body: input.body,
    video_timestamp_seconds: input.timestampSeconds ?? null,
    comment_type: input.commentType ?? "General",
    is_internal_note: !!input.isInternal,
  }).select("*").single();
  if (error) throw error;
  return data;
}

export async function setMediaStatus(itemId: string, status: MediaStatus, userId: string) {
  const patch: any = { status };
  const now = new Date().toISOString();
  if (status === "Reviewed") { patch.reviewed_at = now; patch.reviewed_by = userId; }
  const { error } = await supabase.from("media_items" as any).update(patch).eq("id", itemId);
  if (error) throw error;
}

export async function markAdminViewed(itemId: string) {
  await supabase.from("media_items" as any).update({ admin_last_viewed_at: new Date().toISOString() }).eq("id", itemId);
}
export async function markClientViewed(itemId: string) {
  await supabase.from("media_items" as any).update({ client_last_viewed_at: new Date().toISOString() }).eq("id", itemId);
}

export async function markLiked(itemId: string, userId: string) {
  await supabase.from("media_items" as any).update({ liked_at: new Date().toISOString(), liked_by: userId }).eq("id", itemId);
}
export async function markWatched(itemId: string, userId: string) {
  await supabase.from("media_items" as any).update({ watched_at: new Date().toISOString(), watched_by: userId }).eq("id", itemId);
}

// Upload a single file via resumable session URI returned by the server.
export async function uploadToDrive(uploadUrl: string, file: File, onProgress?: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl, true);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Drive upload failed: ${xhr.status} ${xhr.responseText?.slice(0, 200) ?? ""}`));
    };
    xhr.onerror = () => reject(new Error("Network error during Drive upload"));
    xhr.send(file);
  });
}