import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
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
  "Agreements",
  "Documents",
  "Other Media",
] as const;

const DEFAULT_ROOT_FOLDER_NAME = "JF Effect Client Files";

async function loadSettings(_supabase: any) {
  // Always read Drive settings with the admin client. RLS on
  // media_drive_settings only allows admins, but clients also need to know if
  // uploads are available (so the gate doesn't lie to them and uploads don't
  // throw "not set up" when it actually is).
  const { data } = await (supabaseAdmin as any).from("media_drive_settings").select("*").limit(1).maybeSingle();
  return data as any;
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

// Lightweight readiness check usable by any authenticated user (incl. clients)
// to decide whether to enable upload buttons. Returns only a boolean — no
// folder IDs or admin-only details leak.
export const getDriveReady = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const s = await loadSettings(context.supabase);
    const ready = !!s?.root_folder_id && s?.status === "Ready";
    return { ready, status: (s?.status as string | undefined) ?? "Not Connected" };
  });

// Probe the configured root folder to confirm Drive access still works.
// Updates status to "Ready" or "Error" accordingly.
export const testDriveConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase, context.userId);
    const s = await loadSettings(context.supabase);
    if (!s?.root_folder_id) {
      return { ok: false, status: "Root Folder Missing", message: "No root folder configured." };
    }
    try {
      const meta = await driveGetFile(s.root_folder_id);
      await (context.supabase.from("media_drive_settings" as any) as any).update({
        status: "Ready",
        last_test_at: new Date().toISOString(),
        last_test_result: `OK — ${meta.name}`,
      }).eq("id", s.id);
      return { ok: true, status: "Ready", message: `Connected to ${meta.name}` };
    } catch (err: any) {
      await (context.supabase.from("media_drive_settings" as any) as any).update({
        status: "Error",
        last_test_at: new Date().toISOString(),
        last_test_result: (err?.message ?? "Drive test failed").slice(0, 500),
      }).eq("id", s.id);
      return { ok: false, status: "Error", message: err?.message ?? "Drive test failed" };
    }
  });

export const setupDriveRoot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { folderName?: string; existingFolderId?: string }) => d)
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    let folderId = data.existingFolderId?.trim() || "";
    let folderName = data.folderName?.trim() || DEFAULT_ROOT_FOLDER_NAME;
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
        status: "Ready",
        last_test_at: new Date().toISOString(),
        last_test_result: "OK",
      }).eq("id", existing.id);
    } else {
      await (context.supabase.from("media_drive_settings" as any) as any).insert({
        root_folder_id: folderId, root_folder_url: folderUrl, root_folder_name: folderName,
        status: "Ready", last_test_at: new Date().toISOString(), last_test_result: "OK",
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
  // Use admin client for folder bookkeeping so client uploads aren't blocked
  // by RLS on client_drive_folders / clients.
  const db = supabaseAdmin as any;
  const { data: existing } = await db.from("client_drive_folders").select("*").eq("client_id", clientId).maybeSingle();
  if (existing?.folder_id && existing.subfolders && Object.keys(existing.subfolders).length >= MEDIA_TYPE_SUBFOLDERS.length) {
    return existing;
  }
  const { data: client } = await db.from("clients").select("id, full_name").eq("id", clientId).single();
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
    await db.from("client_drive_folders").update(payload).eq("id", existing.id);
  } else {
    await db.from("client_drive_folders").insert(payload);
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
  .inputValidator((d: { clientId: string; mediaType: string; fileName: string; mimeType: string; sizeBytes: number; displayName?: string }) =>
    z.object({
      clientId: z.string().uuid(),
      mediaType: z.string().min(1),
      fileName: z.string().min(1).max(500),
      mimeType: z.string().min(1).max(200),
      sizeBytes: z.number().int().min(1).max(5 * 1024 * 1024 * 1024),
      displayName: z.string().min(1).max(500).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    // Hard-block uploads if Drive isn't Ready so clients never hit a broken pipeline.
    const s = await loadSettings(context.supabase);
    if (!s?.root_folder_id || s?.status !== "Ready") {
      throw new Error("Google Drive root folder is not set up. Open Settings → Google Drive and create it.");
    }
    const cf = await ensureClientFolder(context.supabase, data.clientId);
    const parentId = (cf.subfolders as any)?.[data.mediaType] ?? (cf.subfolders as any)?.["Other Media"] ?? cf.folder_id;
    if (!parentId) throw new Error("Could not locate a target Drive folder for this media type.");
    // Prefer the caller-supplied display name (already formatted with client name
    // + date + time) so files in Drive match the spec; keep the file extension
    // from the original upload so previews/thumbnails work.
    const ext = data.fileName.includes(".") ? data.fileName.slice(data.fileName.lastIndexOf(".")) : "";
    const finalName = data.displayName
      ? (data.displayName.endsWith(ext) ? data.displayName : `${data.displayName}${ext}`)
      : data.fileName;
    const { uploadUrl } = await driveInitResumableUpload({
      fileName: finalName, mimeType: data.mimeType, sizeBytes: data.sizeBytes, parentId,
    });
    return { uploadUrl, driveFolderId: parentId, driveFileName: finalName, mimeType: data.mimeType, sizeBytes: data.sizeBytes };
  });

export const finalizeMediaUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    clientId: string; submissionId?: string | null; mediaType: string; driveFileId: string;
    clipNote?: string | null; clipOrder?: number; urgent?: boolean; painNote?: string | null;
    uploadedByRole: "admin" | "client";
    driveFolderId?: string | null; fileName?: string | null; mimeType?: string | null; sizeBytes?: number | null;
  }) => d)
  .handler(async ({ data, context }) => {
    let meta: any = null;
    try {
      meta = await driveGetFile(data.driveFileId);
    } catch (err) {
      console.warn(`[drive] uploaded file ${data.driveFileId} could not be read back; saving fallback metadata`, err);
    }
    const settings = await loadSettings(context.supabase);
    if (settings?.share_uploads_with_link) {
      await driveShareAnyoneReader(data.driveFileId);
    }
    const fileId = meta?.id ?? data.driveFileId;
    const { data: row, error } = await ((supabaseAdmin as any).from("media_items") as any).insert({
      submission_id: data.submissionId ?? null,
      client_id: data.clientId,
      media_type: data.mediaType,
      drive_file_id: fileId,
      drive_url: meta?.webViewLink ?? driveViewUrl(fileId),
      drive_embed_url: driveEmbedUrl(fileId),
      drive_folder_id: data.driveFolderId ?? null,
      file_name: meta?.name ?? data.fileName ?? `Drive upload ${fileId}`,
      mime_type: meta?.mimeType ?? data.mimeType ?? null,
      size_bytes: meta?.size ? Number(meta.size) : (data.sizeBytes ?? null),
      duration_seconds: meta?.videoMediaMetadata?.durationMillis ? Number(meta.videoMediaMetadata.durationMillis) / 1000 : null,
      thumbnail_url: meta?.thumbnailLink ?? null,
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
    const isAdmin = await context.supabase
      .from("user_roles" as any)
      .select("role")
      .eq("user_id", context.userId)
      .then(({ data: roles }: any) => roles?.some((r: any) => r.role === "admin"));
    const { data: client, error: clientError } = await (supabaseAdmin as any)
      .from("clients")
      .select("id,user_id,assigned_coach_id")
      .eq("id", data.clientId)
      .maybeSingle();
    const isAssignedCoach = client?.assigned_coach_id
      ? await (supabaseAdmin as any)
        .from("coaches")
        .select("id")
        .eq("id", client.assigned_coach_id)
        .eq("user_id", context.userId)
        .eq("archived", false)
        .eq("status", "Active")
        .maybeSingle()
        .then(({ data: coach }: any) => !!coach)
      : false;

    if (clientError) throw clientError;
    if (!isAdmin && !isAssignedCoach && (!client || client.user_id !== context.userId)) {
      throw new Error("You can only create submissions for your own client profile.");
    }

    const { data: row, error } = await ((supabaseAdmin as any).from("media_submissions") as any).insert({
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