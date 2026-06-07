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

export async function deleteMediaItems(ids: string[]) {
  if (!ids.length) return;
  const { error } = await supabase.from("media_items" as any).delete().in("id", ids);
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
// Returns the Drive file id from the final PUT response body.
export async function uploadToDrive(uploadUrl: string, file: File, onProgress?: (pct: number) => void): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    if (!uploadUrl || !/^https?:\/\//i.test(uploadUrl)) {
      return reject(new Error(`Drive upload aborted: invalid upload URL "${String(uploadUrl).slice(0, 80)}"`));
    }
    const xhr = new XMLHttpRequest();
    try {
      xhr.open("POST", "/api/drive-upload", true);
    } catch (e: any) {
      return reject(new Error(`Drive upload could not start: ${e?.message ?? e}`));
    }
    supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token;
      if (!token) {
        reject(new Error("Drive upload could not start because your session expired. Please sign in again."));
        return;
      }

      const body = new FormData();
      body.append("uploadUrl", uploadUrl);
      body.append("mimeType", file.type || "application/octet-stream");
      body.append("file", file, file.name || "upload");

      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.send(body);
    }).catch((e: any) => reject(new Error(`Drive upload could not read your session: ${e?.message ?? e}`)));
    // Surface timeouts and aborts as clear errors instead of silent network-error.
    xhr.timeout = 10 * 60 * 1000; // 10 minutes
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText || "{}");
          if (!body?.id) return reject(new Error("Drive upload completed but no file id was returned"));
          resolve({ id: body.id });
        } catch (e: any) {
          reject(new Error("Drive upload completed but response was not JSON"));
        }
      } else {
        const detail = (xhr.responseText || "").slice(0, 300).replace(/\s+/g, " ").trim();
        reject(new Error(`Drive upload failed: HTTP ${xhr.status}${detail ? ` — ${detail}` : ""}`));
      }
    };
    xhr.onerror = () => reject(new Error(`Network error while sending the video through the app upload route (status ${xhr.status || 0}).`));
    xhr.ontimeout = () => reject(new Error(`Drive upload timed out after 10 min (${Math.round((file.size || 0) / 1024 / 1024)} MB)`));
    xhr.onabort = () => reject(new Error("Drive upload was aborted by the browser"));
  });
}