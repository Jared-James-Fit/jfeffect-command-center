// Server-only helper that copies a progress_media row's primary-storage file
// into Google Drive as an archive. Mirrors src/lib/lift-archive.server.ts.
// Bypasses RLS via supabaseAdmin. Used by:
//   - the pg_cron-driven /api/public/hooks/progress-archive-tick worker
//   - the admin "Retry archive" server function
//
// Primary storage is the source of truth. Drive is best-effort — failures
// never delete or corrupt the original media. Only coaching client
// submissions (those with a client_id) archive to Drive; member submissions
// remain in app storage only for v1.

const MAX_ATTEMPTS = 5;
const BUCKET = "progress-media";

function backoffMs(attempts: number) {
  // 1m, 2m, 5m, 15m, 60m
  const schedule = [60_000, 120_000, 300_000, 900_000, 3_600_000];
  return schedule[Math.min(attempts, schedule.length - 1)];
}

async function ensureDriveProgressFolder(supabaseAdmin: any, clientId: string) {
  const { driveCreateFolder } = await import("./drive.server");
  const { data: settings } = await supabaseAdmin
    .from("media_drive_settings")
    .select("root_folder_id,status")
    .limit(1)
    .maybeSingle();
  if (!settings?.root_folder_id || settings.status !== "Ready") {
    throw new Error("Google Drive root folder is not ready.");
  }

  const { data: existing } = await supabaseAdmin
    .from("client_drive_folders")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();
  const subfolders = { ...(existing?.subfolders ?? {}) } as Record<string, string>;
  if (subfolders["Progress Media"]) return subfolders["Progress Media"];

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, full_name")
    .eq("id", clientId)
    .single();
  let folderId = existing?.folder_id as string | undefined;
  let folderUrl = existing?.folder_url as string | undefined;
  if (!folderId) {
    const created = await driveCreateFolder(
      `${client.full_name} (${String(clientId).slice(0, 8)})`,
      settings.root_folder_id,
    );
    folderId = created.id;
    folderUrl = created.webViewLink ?? `https://drive.google.com/drive/folders/${folderId}`;
  }
  const progressFolder = await driveCreateFolder("Progress Media", folderId);
  subfolders["Progress Media"] = progressFolder.id;
  const payload = {
    client_id: clientId,
    folder_id: folderId,
    folder_url: folderUrl,
    folder_name: `${client.full_name} (${String(clientId).slice(0, 8)})`,
    subfolders,
    status: "Created",
    last_error: null,
  };
  if (existing) await supabaseAdmin.from("client_drive_folders").update(payload).eq("id", existing.id);
  else await supabaseAdmin.from("client_drive_folders").insert(payload);
  return progressFolder.id;
}

/**
 * Archive a single progress_media row's primary-storage file into Google Drive.
 * Idempotent: a row that already has a Drive file id returns immediately.
 */
export async function archiveProgressMediaToDrive(mediaId: string): Promise<{
  ok: boolean;
  alreadyArchived?: boolean;
  skipped?: boolean;
  driveFileId?: string;
  reason?: string;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { driveShareAnyoneReader, driveEmbedUrl, driveViewUrl } = await import("./drive.server");

  const { data: media, error } = await (supabaseAdmin as any)
    .from("progress_media")
    .select("id, submission_id, user_id, storage_path, mime_type, file_size_bytes, drive_file_id, retry_count")
    .eq("id", mediaId)
    .single();
  if (error) throw error;
  if (!media) throw new Error("Progress media not found.");

  if (media.drive_file_id) {
    await (supabaseAdmin as any).from("progress_media").update({
      drive_sync_status: "saved",
      upload_status: "saved_to_drive",
      processing_error: null,
      synced_at: new Date().toISOString(),
    }).eq("id", mediaId);
    return { ok: true, alreadyArchived: true, driveFileId: media.drive_file_id };
  }
  if (!media.storage_path) return { ok: false, reason: "No primary-storage file to archive." };

  // Resolve the submission's client_id (members don't archive in v1).
  const { data: submission } = await (supabaseAdmin as any)
    .from("progress_submissions")
    .select("id, owner_type, client_id")
    .eq("id", media.submission_id)
    .single();
  if (!submission?.client_id) {
    await (supabaseAdmin as any).from("progress_media").update({
      drive_sync_status: "skipped_member",
    }).eq("id", mediaId);
    return { ok: true, skipped: true, reason: "Member submission — kept in app storage only." };
  }

  // Mark as syncing so concurrent workers skip it.
  await (supabaseAdmin as any).from("progress_media").update({
    drive_sync_status: "syncing",
    upload_status: "syncing_drive",
  }).eq("id", mediaId);

  try {
    const { data: bytes, error: dlErr } = await supabaseAdmin.storage.from(BUCKET).download(media.storage_path);
    if (dlErr) throw dlErr;
    const folderId = await ensureDriveProgressFolder(supabaseAdmin, submission.client_id);
    const fileName = media.storage_path.split("/").pop() ?? `progress-${media.id}`;
    const mimeType = media.mime_type || bytes.type || "application/octet-stream";
    const url =
      "https://connector-gateway.lovable.dev/google_drive/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink,thumbnailLink,mimeType,size";
    const metadata = { name: fileName, parents: [folderId], mimeType };
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("file", bytes, fileName);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": process.env.GOOGLE_DRIVE_API_KEY ?? "",
      },
      body: form,
    });
    if (!res.ok) throw new Error(`Drive copy failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const uploaded = await res.json();
    try { await driveShareAnyoneReader(uploaded.id); } catch { /* sharing is best-effort */ }

    await (supabaseAdmin as any).from("progress_media").update({
      drive_file_id: uploaded.id,
      drive_url: uploaded.webViewLink ?? driveViewUrl(uploaded.id),
      drive_sync_status: "saved",
      upload_status: "saved_to_drive",
      mime_type: uploaded.mimeType ?? mimeType,
      file_size_bytes: uploaded.size ? Number(uploaded.size) : (media.file_size_bytes ?? bytes.size),
      processing_error: null,
      synced_at: new Date().toISOString(),
    }).eq("id", mediaId);
    return { ok: true, driveFileId: uploaded.id };
  } catch (err: any) {
    const attempts = (media.retry_count ?? 0) + 1;
    const reason = err?.message ?? String(err ?? "Unknown Drive archive error");
    const giveUp = attempts >= MAX_ATTEMPTS;
    await (supabaseAdmin as any).from("progress_media").update({
      drive_sync_status: giveUp ? "failed" : "pending",
      upload_status: giveUp ? "sync_failed" : "ready",
      processing_error: reason.slice(0, 1000),
      retry_count: attempts,
    }).eq("id", mediaId);
    return { ok: false, reason };
  }
}

/** Pick up to N pending progress media rows and archive them. Used by pg_cron. */
export async function runProgressArchiveTick(limit = 5): Promise<{
  picked: number;
  archived: number;
  failed: number;
  results: Array<{ id: string; ok: boolean; reason?: string }>;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: rows, error } = await (supabaseAdmin as any)
    .from("progress_media")
    .select("id, retry_count")
    .in("drive_sync_status", ["pending", "failed"])
    .not("storage_path", "is", null)
    .lt("retry_count", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  const results: Array<{ id: string; ok: boolean; reason?: string }> = [];
  let archived = 0;
  let failed = 0;
  for (const row of rows ?? []) {
    const r = await archiveProgressMediaToDrive(row.id);
    if (r.ok) archived++; else failed++;
    results.push({ id: row.id, ok: r.ok, reason: r.reason });
  }
  return { picked: rows?.length ?? 0, archived, failed, results };
}