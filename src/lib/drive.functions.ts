import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  driveCreateFolder,
  driveGetFile,
  driveInitResumableUpload,
  driveShareAnyoneReader,
  driveEmbedUrl,
  driveViewUrl,
} from "./drive.server";

const MEDIA_TYPE_SUBFOLDERS = [
  "Lift Videos",
  "Check-In Videos",
  "Progress Photos",
  "Training Videos",
  "Form Videos",
  "Technique Videos",
  "Documents",
  "Other Media",
] as const;

async function loadSettings(supabase: any) {
  const { data } = await supabase.from("media_drive_settings" as any).select("*").limit(1).maybeSingle();
  return data;
}

async function requireAdmin(supabase: any, userId: string) {
  const { data } = await supabase.from("user_roles" as any).select("role").eq("user_id", userId);
  if (!data?.some((r: any) => r.role === "admin")) {
    throw new Error("Admin only");
  }
}

export const getDriveSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase, context.userId);
    return (await loadSettings(context.supabase)) ?? null;
  });

export const setupDriveRoot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { folderName?: string; existingFolderId?: string }) => d)
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    let folderId = data.existingFolderId?.trim() || "";
    let folderName = data.folderName?.trim() || "JF Effect Coaching Media";
    let folderUrl = "";
    if (!folderId) {
      const created = await driveCreateFolder(folderName);
      folderId = created.id;
      folderName = created.name;
      folderUrl = created.webViewLink ?? `https://drive.google.com/drive/folders/${folderId}`;
    } else {
      const meta = await driveGetFile(folderId);
      folderName = meta.name;
      folderUrl = meta.webViewLink ?? `https://drive.google.com/drive/folders/${folderId}`;
    }
    const existing = await loadSettings(context.supabase);
    if (existing) {
      await (context.supabase.from("media_drive_settings" as any) as any).update({
        root_folder_id: folderId,
        root_folder_url: folderUrl,
        root_folder_name: folderName,
        status: "Connected",
        last_test_at: new Date().toISOString(),
        last_test_result: "OK",
      }).eq("id", existing.id);
    } else {
      await (context.supabase.from("media_drive_settings" as any) as any).insert({
        root_folder_id: folderId, root_folder_url: folderUrl, root_folder_name: folderName,
        status: "Connected", last_test_at: new Date().toISOString(), last_test_result: "OK",
      });
    }
    return { folderId, folderUrl, folderName };
  });

export const setShareUploads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { enabled: boolean }) => d)
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const s = await loadSettings(context.supabase);
    if (s) await (context.supabase.from("media_drive_settings" as any) as any).update({ share_uploads_with_link: data.enabled }).eq("id", s.id);
    return { ok: true };
  });

async function ensureClientFolder(supabase: any, clientId: string) {
  const settings = await loadSettings(supabase);
  if (!settings?.root_folder_id) {
    throw new Error("Google Drive root folder is not set up. Open Settings → Google Drive and create it.");
  }
  const { data: existing } = await supabase.from("client_drive_folders" as any).select("*").eq("client_id", clientId).maybeSingle();
  if (existing?.folder_id && existing.subfolders && Object.keys(existing.subfolders).length >= MEDIA_TYPE_SUBFOLDERS.length) {
    return existing;
  }
  const { data: client } = await supabase.from("clients" as any).select("id, full_name").eq("id", clientId).single();
  const folderName = `${client.full_name} (${String(clientId).slice(0, 8)})`;
  let folderId = existing?.folder_id as string | undefined;
  let folderUrl = existing?.folder_url as string | undefined;
  if (!folderId) {
    const created = await driveCreateFolder(folderName, settings.root_folder_id);
    folderId = created.id;
    folderUrl = created.webViewLink ?? `https://drive.google.com/drive/folders/${folderId}`;
  }
  const subfolders: Record<string, string> = { ...(existing?.subfolders ?? {}) };
  for (const type of MEDIA_TYPE_SUBFOLDERS) {
    if (subfolders[type]) continue;
    const sub = await driveCreateFolder(type, folderId!);
    subfolders[type] = sub.id;
  }
  const payload = {
    client_id: clientId,
    folder_id: folderId,
    folder_url: folderUrl,
    folder_name: folderName,
    subfolders,
    status: "Created",
    last_error: null as string | null,
  };
  if (existing) {
    await supabase.from("client_drive_folders" as any).update(payload).eq("id", existing.id);
  } else {
    await supabase.from("client_drive_folders" as any).insert(payload);
  }
  return payload;
}

export const provisionClientFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string }) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    return ensureClientFolder(context.supabase, data.clientId);
  });

export const initMediaUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string; mediaType: string; fileName: string; mimeType: string; sizeBytes: number }) =>
    z.object({
      clientId: z.string().uuid(),
      mediaType: z.string().min(1),
      fileName: z.string().min(1).max(500),
      mimeType: z.string().min(1).max(200),
      sizeBytes: z.number().int().min(1).max(5 * 1024 * 1024 * 1024),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const cf = await ensureClientFolder(context.supabase, data.clientId);
    const parentId = (cf.subfolders as any)?.[data.mediaType] ?? (cf.subfolders as any)?.["Other Media"] ?? cf.folder_id;
    if (!parentId) throw new Error("Could not locate a target Drive folder for this media type.");
    const { uploadUrl } = await driveInitResumableUpload({
      fileName: data.fileName, mimeType: data.mimeType, sizeBytes: data.sizeBytes, parentId,
    });
    return { uploadUrl, driveFolderId: parentId };
  });

export const finalizeMediaUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    clientId: string; submissionId?: string | null; mediaType: string; driveFileId: string;
    clipNote?: string | null; clipOrder?: number; urgent?: boolean; painNote?: string | null;
    uploadedByRole: "admin" | "client";
  }) => d)
  .handler(async ({ data, context }) => {
    const meta = await driveGetFile(data.driveFileId);
    const settings = await loadSettings(context.supabase);
    if (settings?.share_uploads_with_link) {
      await driveShareAnyoneReader(data.driveFileId);
    }
    const { data: row, error } = await (context.supabase.from("media_items" as any) as any).insert({
      submission_id: data.submissionId ?? null,
      client_id: data.clientId,
      media_type: data.mediaType,
      drive_file_id: meta.id,
      drive_url: meta.webViewLink ?? driveViewUrl(meta.id),
      drive_embed_url: driveEmbedUrl(meta.id),
      file_name: meta.name,
      mime_type: meta.mimeType,
      size_bytes: meta.size ? Number(meta.size) : null,
      duration_seconds: meta.videoMediaMetadata?.durationMillis ? Number(meta.videoMediaMetadata.durationMillis) / 1000 : null,
      thumbnail_url: meta.thumbnailLink ?? null,
      clip_note: data.clipNote ?? null,
      clip_order: data.clipOrder ?? 0,
      urgent_flag: !!data.urgent,
      pain_note: data.painNote ?? null,
      uploaded_by: context.userId,
      uploaded_by_role: data.uploadedByRole,
      status: "Pending Review",
    }).select("*").single();
    if (error) throw error;
    return row;
  });

export const createSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    clientId: string; submissionType: string; title?: string | null; batchNote?: string | null;
    urgent?: boolean; painNote?: string | null; clipCount: number; role: "admin" | "client";
  }) => d)
  .handler(async ({ data, context }) => {
    const { data: row, error } = await (context.supabase.from("media_submissions" as any) as any).insert({
      client_id: data.clientId,
      submission_type: data.submissionType,
      title: data.title ?? null,
      batch_note: data.batchNote ?? null,
      urgent_flag: !!data.urgent,
      pain_note: data.painNote ?? null,
      clip_count: data.clipCount,
      created_by: context.userId,
      created_by_role: data.role,
      status: "Pending Review",
    }).select("*").single();
    if (error) throw error;
    return row;
  });