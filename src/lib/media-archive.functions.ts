import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ------------------------- Types -------------------------

export type ArchiveSourceType = "message_attachment" | "lift_video" | "media_item";
export type ArchiveStatus = "queued" | "archiving" | "archived" | "failed" | "restored";
export type ArchiveVisibility = "admin_only" | "visible_to_client" | "follow_original";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ------------------------- Helpers -------------------------

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function requireAdmin(supabase: any, userId: string) {
  const { data } = await supabase.from("user_roles" as any).select("role").eq("user_id", userId);
  if (!data?.some((r: any) => r.role === "admin")) throw new Error("Admin only");
}

async function ensureYearMonthFolder(
  parentId: string,
  date: Date,
): Promise<{ folderId: string; path: string }> {
  const { driveEnsureFolder } = await import("./drive.server");
  const year = String(date.getUTCFullYear());
  const month = MONTHS[date.getUTCMonth()];
  const y = await driveEnsureFolder(year, parentId);
  const m = await driveEnsureFolder(month, y.id);
  return { folderId: m.id, path: `${year}/${month}` };
}

async function getClientFolders(db: any, clientId: string) {
  const { data } = await db.from("client_drive_folders").select("*").eq("client_id", clientId).maybeSingle();
  return data;
}

function subfolderFor(sourceType: ArchiveSourceType, mediaType?: string | null): string {
  if (sourceType === "lift_video") return "Lift Videos";
  if (sourceType === "message_attachment") return "Chat Media";
  // media_item
  if (mediaType === "Lift Videos") return "Lift Videos";
  if (mediaType === "Progress Photos") return "Progress Photos";
  if (mediaType === "Check-In Videos" || mediaType === "Check-In Media") return "Check-In Videos";
  if (mediaType === "Documents") return "Documents";
  if (mediaType === "Agreements") return "Agreements";
  return "Other Media";
}

// Download bytes from a Supabase Storage object (bucket + path) via admin signed URL.
async function fetchStorageBytes(bucket: string, path: string) {
  const db = await getAdmin();
  const { data, error } = await db.storage.from(bucket).createSignedUrl(path, 60 * 5);
  if (error || !data?.signedUrl) throw new Error(`Couldn't sign ${bucket}/${path}: ${error?.message ?? "no url"}`);
  const res = await fetch(data.signedUrl);
  if (!res.ok) throw new Error(`Download ${bucket}/${path} failed (${res.status})`);
  const buf = await res.arrayBuffer();
  return buf;
}

// Fetch bytes from an arbitrary public URL (used when storage path is unknown).
async function fetchPublicBytes(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download ${url} failed (${res.status})`);
  return res.arrayBuffer();
}

// Try to extract { bucket, path } from a supabase storage URL.
function parseStorageUrl(url: string): { bucket: string; path: string } | null {
  try {
    const u = new URL(url);
    // /storage/v1/object/(public|sign|authenticated)/<bucket>/<path...>
    const m = u.pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
    if (!m) return null;
    return { bucket: decodeURIComponent(m[1]), path: decodeURIComponent(m[2].split("?")[0]) };
  } catch {
    return null;
  }
}

// ------------------------- Settings -------------------------

const SettingsSchema = z.object({
  auto_archive_enabled: z.boolean().optional(),
  chat_media_retention_days: z.number().int().min(0).max(3650).optional(),
  lift_video_retention_days: z.number().int().min(0).max(3650).optional(),
  checkin_retention_days: z.number().int().min(0).max(3650).optional(),
  progress_retention_days: z.number().int().min(0).max(3650).optional(),
  default_visibility: z.enum(["admin_only", "visible_to_client", "follow_original"]).optional(),
});

export const getArchiveSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase, context.userId);
    const db = await getAdmin();
    const { data } = await db.from("media_archive_settings").select("*").limit(1).maybeSingle();
    return data ?? null;
  });

export const updateArchiveSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => SettingsSchema.parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const db = await getAdmin();
    const { data: existing } = await db.from("media_archive_settings").select("id").limit(1).maybeSingle();
    if (existing) {
      await db.from("media_archive_settings").update(data).eq("id", existing.id);
    } else {
      await db.from("media_archive_settings").insert({ singleton: true, ...data });
    }
    return { ok: true };
  });

// ------------------------- Client folder snapshot -------------------------

export const getClientDriveFolderInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const db = await getAdmin();
    const cf = await getClientFolders(db, data.clientId);
    return cf ?? null;
  });

// ------------------------- Archive engine -------------------------

async function ensureArchiveRow(
  db: any,
  source: { client_id: string; source_type: ArchiveSourceType; source_id: string; source_subkey?: string | null; created_by?: string | null; visibility?: ArchiveVisibility },
) {
  const { data: existing } = await db
    .from("media_archives")
    .select("*")
    .eq("source_type", source.source_type)
    .eq("source_id", source.source_id)
    .eq("source_subkey", source.source_subkey ?? null)
    .maybeSingle();
  if (existing) return existing;
  const { data, error } = await db.from("media_archives").insert({
    client_id: source.client_id,
    source_type: source.source_type,
    source_id: source.source_id,
    source_subkey: source.source_subkey ?? null,
    archive_status: "queued",
    visibility: source.visibility ?? "follow_original",
    created_by: source.created_by ?? null,
  }).select("*").single();
  if (error) throw error;
  return data;
}

async function runArchiveJob(db: any, archiveId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: job } = await db.from("media_archives").select("*").eq("id", archiveId).single();
  if (!job) return { ok: false, error: "Job not found" };
  if (job.archive_status === "archived") return { ok: true };

  await db.from("media_archives").update({
    archive_status: "archiving",
    attempts: (job.attempts ?? 0) + 1,
    last_error: null,
  }).eq("id", archiveId);

  try {
    // Resolve source bytes + naming + date
    let bytes: ArrayBuffer | null = null;
    let fileName = job.file_name as string | null;
    let mimeType = job.mime_type as string | null;
    let mediaType: string | null = null;
    let sourceDate = new Date(job.created_at ?? Date.now());
    let originalVisible = true;

    if (job.source_type === "lift_video") {
      const { data: lv } = await db.from("lift_videos").select("*").eq("id", job.source_id).single();
      if (!lv) throw new Error("Lift video row not found");
      sourceDate = new Date(lv.created_at);
      fileName = fileName || `${lv.exercise || "lift"}-${lv.id.slice(0, 8)}.mp4`;
      mimeType = mimeType || "video/mp4";
      if (lv.drive_file_id) {
        // Already on Drive — just bookkeep
        const { driveGetFile } = await import("./drive.server");
        const meta = await driveGetFile(lv.drive_file_id);
        await db.from("media_archives").update({
          drive_file_id: lv.drive_file_id,
          drive_url: lv.drive_url ?? meta.webViewLink ?? null,
          drive_folder_id: lv.drive_folder_id ?? null,
          file_name: meta.name,
          mime_type: meta.mimeType,
          size_bytes: meta.size ? Number(meta.size) : null,
          archive_status: "archived",
          archived_at: new Date().toISOString(),
        }).eq("id", archiveId);
        await db.from("lift_videos").update({ archive_status: "archived" }).eq("id", lv.id);
        return { ok: true };
      }
      if (lv.video_storage_path) {
        bytes = await fetchStorageBytes("lift-videos", lv.video_storage_path);
      } else if (lv.video_url) {
        const parsed = parseStorageUrl(lv.video_url);
        bytes = parsed ? await fetchStorageBytes(parsed.bucket, parsed.path) : await fetchPublicBytes(lv.video_url);
      } else {
        throw new Error("Lift video has no storage path or URL");
      }
    } else if (job.source_type === "media_item") {
      const { data: mi } = await db.from("media_items").select("*").eq("id", job.source_id).single();
      if (!mi) throw new Error("Media item row not found");
      sourceDate = new Date(mi.created_at);
      mediaType = mi.media_type;
      fileName = fileName || mi.file_name || `${mi.media_type}-${mi.id.slice(0, 8)}`;
      mimeType = mimeType || mi.mime_type || "application/octet-stream";
      if (mi.drive_file_id) {
        await db.from("media_archives").update({
          drive_file_id: mi.drive_file_id,
          drive_url: mi.drive_url,
          drive_folder_id: mi.drive_folder_id,
          file_name: mi.file_name,
          mime_type: mi.mime_type,
          size_bytes: mi.size_bytes,
          archive_status: "archived",
          archived_at: new Date().toISOString(),
        }).eq("id", archiveId);
        await db.from("media_items").update({ archive_status: "archived" }).eq("id", mi.id);
        return { ok: true };
      }
      if (mi.external_link) {
        const parsed = parseStorageUrl(mi.external_link);
        bytes = parsed ? await fetchStorageBytes(parsed.bucket, parsed.path) : await fetchPublicBytes(mi.external_link);
      } else {
        throw new Error("Media item has no source URL to archive");
      }
    } else if (job.source_type === "message_attachment") {
      const { data: msg } = await db.from("messages").select("*").eq("id", job.source_id).single();
      if (!msg) throw new Error("Message not found");
      sourceDate = new Date(msg.created_at);
      const attachments = (msg.attachments ?? []) as any[];
      const idx = job.source_subkey ? parseInt(job.source_subkey, 10) : 0;
      const att = attachments[idx];
      if (!att) throw new Error(`Attachment index ${idx} not found`);
      fileName = fileName || att.name || `chat-${msg.id.slice(0, 8)}-${idx}`;
      mimeType = mimeType || att.type || att.mime_type || "application/octet-stream";
      const url = att.url || att.public_url || att.signed_url || att.storage_url;
      const path = att.path || att.storage_path;
      const bucket = att.bucket || "message-attachments";
      if (path) {
        bytes = await fetchStorageBytes(bucket, path);
      } else if (url) {
        const parsed = parseStorageUrl(url);
        bytes = parsed ? await fetchStorageBytes(parsed.bucket, parsed.path) : await fetchPublicBytes(url);
      } else {
        throw new Error("Attachment has no URL or path");
      }
      originalVisible = msg.sender_role === "client" || msg.sender_role === "admin";
    }

    if (!bytes) throw new Error("No bytes to upload");

    // Resolve target folder: <client>/<subfolder>/<year>/<month>
    const cf = await getClientFolders(db, job.client_id);
    if (!cf?.folder_id) {
      // Provision now via the existing helper path — call drive.functions.ensureClientFolder by reaching its inner logic.
      // We import drive.functions.ts is not possible from server-only; replicate the minimal path:
      throw new Error("Client Drive folder not provisioned. Open the client profile and click \"Create Drive Folders\".");
    }
    const sub = subfolderFor(job.source_type as ArchiveSourceType, mediaType);
    const subId = (cf.subfolders as any)?.[sub];
    if (!subId) throw new Error(`Missing subfolder "${sub}" in this client's Drive folder. Repair folders to fix.`);
    const ym = await ensureYearMonthFolder(subId, sourceDate);

    const { driveMultipartUpload, driveShareAnyoneReader, driveEmbedUrl, driveViewUrl } = await import("./drive.server");

    // Settings for sharing
    const { data: settings } = await db.from("media_drive_settings").select("share_uploads_with_link").limit(1).maybeSingle();
    const uploaded = await driveMultipartUpload({
      fileName: fileName!,
      mimeType: mimeType!,
      parentId: ym.folderId,
      body: bytes,
    });
    if (settings?.share_uploads_with_link) {
      await driveShareAnyoneReader(uploaded.id);
    }

    // Resolve visibility
    let visibility = job.visibility as ArchiveVisibility;
    if (visibility === "follow_original") {
      visibility = originalVisible ? "visible_to_client" : "admin_only";
    }

    await db.from("media_archives").update({
      drive_file_id: uploaded.id,
      drive_url: uploaded.webViewLink ?? driveViewUrl(uploaded.id),
      drive_folder_id: ym.folderId,
      drive_folder_path: `${cf.folder_name}/${sub}/${ym.path}`,
      file_name: uploaded.name,
      mime_type: uploaded.mimeType,
      size_bytes: uploaded.size ? Number(uploaded.size) : (bytes.byteLength as number),
      archive_status: "archived",
      visibility,
      archived_at: new Date().toISOString(),
      last_error: null,
    }).eq("id", archiveId);

    // Stamp source rows for fast joins
    if (job.source_type === "lift_video") {
      await db.from("lift_videos").update({
        drive_file_id: uploaded.id,
        drive_url: uploaded.webViewLink ?? driveViewUrl(uploaded.id),
        drive_folder_id: ym.folderId,
        archive_status: "archived",
      }).eq("id", job.source_id);
    } else if (job.source_type === "media_item") {
      await db.from("media_items").update({
        drive_file_id: uploaded.id,
        drive_url: uploaded.webViewLink ?? driveViewUrl(uploaded.id),
        drive_embed_url: driveEmbedUrl(uploaded.id),
        drive_folder_id: ym.folderId,
        archive_status: "archived",
      }).eq("id", job.source_id);
    }

    return { ok: true };
  } catch (err: any) {
    const msg = (err?.message ?? "Archive failed").slice(0, 1000);
    await db.from("media_archives").update({
      archive_status: "failed",
      last_error: msg,
    }).eq("id", archiveId);
    return { ok: false, error: msg };
  }
}

// Queue + immediately run an archive for one source item.
export const archiveOne = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      clientId: z.string().uuid(),
      sourceType: z.enum(["message_attachment", "lift_video", "media_item"]),
      sourceId: z.string().uuid(),
      sourceSubkey: z.string().max(50).nullable().optional(),
      visibility: z.enum(["admin_only", "visible_to_client", "follow_original"]).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const db = await getAdmin();
    const job = await ensureArchiveRow(db, {
      client_id: data.clientId,
      source_type: data.sourceType,
      source_id: data.sourceId,
      source_subkey: data.sourceSubkey ?? null,
      created_by: context.userId,
      visibility: data.visibility,
    });
    return runArchiveJob(db, job.id);
  });

// Retry a previously failed archive.
export const retryArchive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ archiveId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const db = await getAdmin();
    return runArchiveJob(db, data.archiveId);
  });

// Listing for Media Archive Manager
export const listMediaArchives = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      status: z.enum(["queued", "archiving", "archived", "failed", "restored", "all"]).optional(),
      clientId: z.string().uuid().optional(),
      sourceType: z.enum(["message_attachment", "lift_video", "media_item", "all"]).optional(),
      search: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const db = await getAdmin();
    let q = db.from("media_archives").select("*, clients!inner(id, full_name)").order("created_at", { ascending: false }).limit(data.limit ?? 200);
    if (data.status && data.status !== "all") q = q.eq("archive_status", data.status);
    if (data.sourceType && data.sourceType !== "all") q = q.eq("source_type", data.sourceType);
    if (data.clientId) q = q.eq("client_id", data.clientId);
    if (data.search) q = q.ilike("file_name", `%${data.search}%`);
    const { data: rows, error } = await q;
    if (error) throw error;
    return { rows: rows ?? [] };
  });

// Update visibility on an archived item.
export const setArchiveVisibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      archiveId: z.string().uuid(),
      visibility: z.enum(["admin_only", "visible_to_client", "follow_original"]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const db = await getAdmin();
    await db.from("media_archives").update({ visibility: data.visibility }).eq("id", data.archiveId);
    return { ok: true };
  });

// Sweep: find items older than retention windows, archive them.
// Returns counts. Idempotent — already-archived rows are skipped via UNIQUE(source).
export async function runAutoArchiveInternal() {
  const db = await getAdmin();
  const { data: settings } = await db.from("media_archive_settings").select("*").limit(1).maybeSingle();
  if (!settings?.auto_archive_enabled) return { skipped: true, reason: "auto-archive disabled" };

  const summary: Record<string, number> = { chat: 0, lift: 0, media: 0, failed: 0 };
  const now = Date.now();

  // Chat attachments older than retention
  const chatCutoff = new Date(now - settings.chat_media_retention_days * 86400_000).toISOString();
  const { data: oldMessages } = await db
    .from("messages")
    .select("id, client_id, attachments, created_at")
    .lt("created_at", chatCutoff)
    .not("attachments", "eq", "[]")
    .limit(50);
  for (const m of (oldMessages ?? [])) {
    const arr = (m.attachments ?? []) as any[];
    for (let i = 0; i < arr.length; i++) {
      const job = await ensureArchiveRow(db, {
        client_id: m.client_id,
        source_type: "message_attachment",
        source_id: m.id,
        source_subkey: String(i),
        visibility: settings.default_visibility ?? "follow_original",
      });
      if (job.archive_status === "archived") continue;
      const r = await runArchiveJob(db, job.id);
      r.ok ? summary.chat++ : summary.failed++;
    }
  }

  // Lift videos
  const liftCutoff = new Date(now - settings.lift_video_retention_days * 86400_000).toISOString();
  const { data: oldLifts } = await db
    .from("lift_videos")
    .select("id, client_id, created_at, drive_file_id, video_storage_path, video_url")
    .lt("created_at", liftCutoff)
    .is("drive_file_id", null)
    .limit(50);
  for (const lv of (oldLifts ?? [])) {
    const job = await ensureArchiveRow(db, {
      client_id: lv.client_id, source_type: "lift_video", source_id: lv.id,
      visibility: settings.default_visibility ?? "follow_original",
    });
    if (job.archive_status === "archived") continue;
    const r = await runArchiveJob(db, job.id);
    r.ok ? summary.lift++ : summary.failed++;
  }

  // Media items (check-in / progress) — pick the lower of the two retention windows
  const mediaCutoffDays = Math.min(settings.checkin_retention_days, settings.progress_retention_days);
  const mediaCutoff = new Date(now - mediaCutoffDays * 86400_000).toISOString();
  const { data: oldMedia } = await db
    .from("media_items")
    .select("id, client_id, created_at, drive_file_id, external_link, media_type")
    .lt("created_at", mediaCutoff)
    .is("drive_file_id", null)
    .in("media_type", ["Check-In Videos", "Check-In Media", "Progress Photos", "Documents"])
    .limit(50);
  for (const mi of (oldMedia ?? [])) {
    const job = await ensureArchiveRow(db, {
      client_id: mi.client_id, source_type: "media_item", source_id: mi.id,
      visibility: settings.default_visibility ?? "follow_original",
    });
    if (job.archive_status === "archived") continue;
    const r = await runArchiveJob(db, job.id);
    r.ok ? summary.media++ : summary.failed++;
  }

  await db.from("media_archive_settings").update({
    last_run_at: new Date().toISOString(),
    last_run_summary: `chat:${summary.chat} lift:${summary.lift} media:${summary.media} failed:${summary.failed}`,
  }).eq("id", settings.id);

  return { ...summary, skipped: false };
}

// Manually trigger the sweep from the UI.
export const runAutoArchiveNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase, context.userId);
    return runAutoArchiveInternal();
  });