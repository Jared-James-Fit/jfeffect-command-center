// Server-only helpers for Google Drive API via the Lovable connector gateway.
// Uses the `drive.file` scope, so the app can only see files it creates.

const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";

function gwHeaders() {
  const lovable = process.env.LOVABLE_API_KEY;
  const drive = process.env.GOOGLE_DRIVE_API_KEY;
  if (!lovable || !drive) {
    throw new Error("Google Drive connector is not configured. Reconnect it under Settings → Integrations.");
  }
  return {
    Authorization: `Bearer ${lovable}`,
    "X-Connection-Api-Key": drive,
  } as Record<string, string>;
}

async function driveJson<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const url = path.startsWith("http") ? path : `${GATEWAY}${path}`;
  const headers = { ...gwHeaders(), "Content-Type": "application/json", ...(init.headers as any) };
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Drive API ${res.status}: ${text.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

export async function driveCreateFolder(name: string, parentId?: string | null) {
  const body: any = { name, mimeType: "application/vnd.google-apps.folder" };
  if (parentId) body.parents = [parentId];
  return driveJson<{ id: string; name: string; webViewLink?: string }>(
    "/drive/v3/files?fields=id,name,webViewLink&supportsAllDrives=true",
    { method: "POST", body: JSON.stringify(body) },
  );
}

export async function driveGetFile(fileId: string) {
  return driveJson<{
    id: string;
    name: string;
    mimeType: string;
    size?: string;
    webViewLink?: string;
    thumbnailLink?: string;
    videoMediaMetadata?: { durationMillis?: string };
  }>(
    `/drive/v3/files/${fileId}?fields=id,name,mimeType,size,webViewLink,thumbnailLink,videoMediaMetadata&supportsAllDrives=true`,
  );
}

export async function driveShareAnyoneReader(fileId: string) {
  try {
    await driveJson(`/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`, {
      method: "POST",
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    });
  } catch (err) {
    console.warn(`[drive] could not share file ${fileId}:`, err);
  }
}

// Resumable upload session — returns a pre-authorized URI the browser PUTs the file to.
export async function driveInitResumableUpload(params: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  parentId: string;
}) {
  const url = `${GATEWAY}/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...gwHeaders(),
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": params.mimeType,
      "X-Upload-Content-Length": String(params.sizeBytes),
    },
    body: JSON.stringify({ name: params.fileName, parents: [params.parentId], mimeType: params.mimeType }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[drive.resumable-init] gateway ${res.status}`, { fileName: params.fileName, mimeType: params.mimeType, sizeBytes: params.sizeBytes, body: text.slice(0, 500) });
    throw new Error(`Drive resumable init ${res.status}: ${text.slice(0, 500)}`);
  }
  const uploadUrl = res.headers.get("location") || res.headers.get("Location");
  if (!uploadUrl) {
    const headerDump: string[] = [];
    res.headers.forEach((v, k) => headerDump.push(`${k}=${v.slice(0, 80)}`));
    console.error("[drive.resumable-init] missing Location header", { headers: headerDump });
    throw new Error(`Drive did not return a resumable upload URL. Gateway headers: ${headerDump.join(", ").slice(0, 400)}`);
  }
  console.log(`[drive.resumable-init] ok`, { fileName: params.fileName, mimeType: params.mimeType, sizeBytes: params.sizeBytes, uploadHost: uploadUrl.split("?")[0] });
  return { uploadUrl };
}

export function driveEmbedUrl(fileId: string) {
  return `https://drive.google.com/file/d/${fileId}/preview`;
}

export function driveViewUrl(fileId: string) {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

// Find an existing folder by exact name under a given parent. Returns null if missing.
export async function driveFindFolderByName(name: string, parentId: string) {
  const q = encodeURIComponent(
    `mimeType = 'application/vnd.google-apps.folder' and trashed = false and name = '${name.replace(/'/g, "\\'")}' and '${parentId}' in parents`,
  );
  const res = await driveJson<{ files?: Array<{ id: string; name: string; webViewLink?: string }> }>(
    `/drive/v3/files?q=${q}&fields=files(id,name,webViewLink)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
  );
  return res.files?.[0] ?? null;
}

// Get-or-create a named subfolder under parent.
export async function driveEnsureFolder(name: string, parentId: string) {
  const found = await driveFindFolderByName(name, parentId);
  if (found) return found;
  return driveCreateFolder(name, parentId);
}

// One-shot multipart upload (file content + metadata) — preferred for archive
// jobs because we already have the bytes in memory after fetching the original.
export async function driveMultipartUpload(params: {
  fileName: string;
  mimeType: string;
  parentId: string;
  body: ArrayBuffer | Uint8Array;
}) {
  const boundary = `lovable-${Math.random().toString(36).slice(2)}`;
  const meta = { name: params.fileName, parents: [params.parentId], mimeType: params.mimeType };
  const bytes = params.body instanceof Uint8Array ? params.body : new Uint8Array(params.body);
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${params.mimeType}\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);
  const url = `${GATEWAY}/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,size,webViewLink,thumbnailLink`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...gwHeaders(), "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Drive multipart upload ${res.status}: ${text.slice(0, 500)}`);
  }
  return (await res.json()) as { id: string; name: string; mimeType: string; size?: string; webViewLink?: string; thumbnailLink?: string };
}