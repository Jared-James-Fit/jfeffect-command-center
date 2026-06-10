// Server-only helper that copies a lift_videos row's primary-storage file
// into Google Drive as an archive. Bypasses RLS via supabaseAdmin. Used by:
//   - the pg_cron-driven /api/public/hooks/lift-archive-tick worker
//   - the admin "Retry archive" server function
//
// The primary storage file is the source of truth. Drive is best-effort —
// failures never delete or corrupt the original.

const MAX_ATTEMPTS = 5;

function backoffMs(attempts: number) {
  // 1m, 2m, 5m, 15m, 60m
  const schedule = [60_000, 120_000, 300_000, 900_000, 3_600_000];
  return schedule[Math.min(attempts, schedule.length - 1)];
}

async function ensureDriveLiftFolder(supabaseAdmin: any, clientId: string) {
  const { driveCreateFolder } = await import("./drive.server");
  const { data: settings } = await supabaseAdmin.from("media_drive_settings").select("root_folder_id,status").limit(1).maybeSingle();
  if (!settings?.root_folder_id || settings.status !== "Ready") {
    throw new Error("Google Drive root folder is not ready.");
  }

  const { data: existing } = await supabaseAdmin.from("client_drive_folders").select("*").eq("client_id", clientId).maybeSingle();
  const subfolders = { ...(existing?.subfolders ?? {}) } as Record<string, string>;
  if (subfolders["Lift Videos"]) return subfolders["Lift Videos"];

  const { data: client } = await supabaseAdmin.from("clients").select("id, full_name").eq("id", clientId).single();
  let folderId = existing?.folder_id as string | undefined;
  let folderUrl = existing?.folder_url as string | undefined;
  if (!folderId) {
    const created = await driveCreateFolder(`${client.full_name} (${String(clientId).slice(0, 8)})`, settings.root_folder_id);
    folderId = created.id;
    folderUrl = created.webViewLink ?? `https://drive.google.com/drive/folders/${folderId}`;
  }
  const liftFolder = await driveCreateFolder("Lift Videos", folderId);
  subfolders["Lift Videos"] = liftFolder.id;
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
  return liftFolder.id;
}

/**
 * Archive a single lift video's primary-storage file into Google Drive.
 * Idempotent: a row that already has a Drive file id returns immediately.
 */
export async function archiveLiftVideoToDrive(videoId: string): Promise<{
  ok: boolean;
  alreadyArchived?: boolean;
  driveFileId?: string;
  reason?: string;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { driveShareAnyoneReader, driveEmbedUrl, driveViewUrl } = await import("./drive.server");

  const { data: video, error } = await (supabaseAdmin as any)
    .from("lift_videos")
    .select("id, client_id, video_storage_path, original_drive_file_id, drive_file_id, file_type, archive_attempts")
    .eq("id", videoId)
    .single();
  if (error) throw error;
  if (!video) throw new Error("Lift video not found.");

  const existingDriveId = video.drive_file_id ?? video.original_drive_file_id;
  if (existingDriveId) {
    await (supabaseAdmin as any).from("lift_videos").update({
      archive_status: "archived",
      archive_error: null,
      archive_next_attempt_at: null,
    }).eq("id", videoId);
    return { ok: true, alreadyArchived: true, driveFileId: existingDriveId };
  }
  if (!video.video_storage_path) {
    return { ok: false, reason: "No primary-storage file to archive." };
  }

  // Mark as archiving so concurrent workers skip it.
  await (supabaseAdmin as any).from("lift_videos").update({
    archive_status: "archiving",
    archive_last_attempt_at: new Date().toISOString(),
  }).eq("id", videoId);

  try {
    const { data: bytes, error: dlErr } = await supabaseAdmin.storage.from("lift-videos").download(video.video_storage_path);
    if (dlErr) throw dlErr;
    const folderId = await ensureDriveLiftFolder(supabaseAdmin, video.client_id);
    const fileName = video.video_storage_path.split("/").pop() ?? `lift-video-${video.id}.mp4`;
    const mimeType = video.file_type || bytes.type || "video/mp4";
    const url = "https://connector-gateway.lovable.dev/google_drive/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink,thumbnailLink,mimeType,size";
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

    await (supabaseAdmin as any).from("lift_videos").update({
      drive_file_id: uploaded.id,
      drive_url: uploaded.webViewLink ?? driveViewUrl(uploaded.id),
      drive_folder_id: folderId,
      original_drive_file_id: uploaded.id,
      original_drive_url: uploaded.webViewLink ?? driveViewUrl(uploaded.id),
      drive_embed_url: driveEmbedUrl(uploaded.id),
      thumbnail_url: uploaded.thumbnailLink ?? null,
      file_type: uploaded.mimeType ?? mimeType,
      file_size_bytes: uploaded.size ? Number(uploaded.size) : bytes.size,
      archive_status: "archived",
      archive_error: null,
      archive_next_attempt_at: null,
    }).eq("id", videoId);
    return { ok: true, driveFileId: uploaded.id };
  } catch (err: any) {
    const attempts = (video.archive_attempts ?? 0) + 1;
    const reason = err?.message ?? String(err ?? "Unknown Drive archive error");
    const giveUp = attempts >= MAX_ATTEMPTS;
    await (supabaseAdmin as any).from("lift_videos").update({
      archive_status: giveUp ? "failed" : "pending",
      archive_error: reason.slice(0, 1000),
      archive_attempts: attempts,
      archive_next_attempt_at: giveUp ? null : new Date(Date.now() + backoffMs(attempts)).toISOString(),
    }).eq("id", videoId);
    return { ok: false, reason };
  }
}

/** Pick up to N pending lift videos and archive them. Used by pg_cron. */
export async function runLiftArchiveTick(limit = 5): Promise<{
  picked: number;
  archived: number;
  failed: number;
  results: Array<{ id: string; ok: boolean; reason?: string }>;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const nowIso = new Date().toISOString();
  const { data: rows, error } = await (supabaseAdmin as any)
    .from("lift_videos")
    .select("id")
    .in("archive_status", ["pending", "failed"])
    .not("video_storage_path", "is", null)
    .or(`archive_next_attempt_at.is.null,archive_next_attempt_at.lte.${nowIso}`)
    .lt("archive_attempts", MAX_ATTEMPTS)
    .order("archive_next_attempt_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw error;
  const results: Array<{ id: string; ok: boolean; reason?: string }> = [];
  let archived = 0;
  let failed = 0;
  for (const row of rows ?? []) {
    const r = await archiveLiftVideoToDrive(row.id);
    if (r.ok) archived++; else failed++;
    results.push({ id: row.id, ok: r.ok, reason: r.reason });
  }
  return { picked: rows?.length ?? 0, archived, failed, results };
}