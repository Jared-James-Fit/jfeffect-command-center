/**
 * Client side of "snap a receipt": shrink phone photos (a 12MP shot is 3-5MB,
 * a readable receipt needs a fraction of that), upload to the private
 * business-receipts bucket, and hand the path to Summer to read.
 */
import { supabase } from "@/integrations/supabase/client";
import { RECEIPTS_BUCKET } from "@/lib/business-books";

const MAX_EDGE = 2000;
const MAX_BYTES = 15 * 1024 * 1024;

export const RECEIPT_ACCEPT = "image/*,application/pdf";

async function shrinkImage(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85));
  } catch {
    // Formats the browser can't decode (e.g. HEIC on Chrome) go up as-is.
    return null;
  }
}

export async function uploadReceiptFile(file: File, date = new Date()): Promise<{ path: string; mime: string }> {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  let body: Blob = file;
  let mime = isPdf ? "application/pdf" : file.type || "image/jpeg";
  let ext = isPdf ? "pdf" : (file.name.split(".").pop() || "jpg").toLowerCase();

  if (!isPdf) {
    const small = await shrinkImage(file);
    if (small && small.size < file.size) {
      body = small;
      mime = "image/jpeg";
      ext = "jpg";
    }
  }
  if (body.size > MAX_BYTES) throw new Error(`${file.name} is over 15 MB.`);

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `${y}/${y}-${m}/${id}.${ext.replace(/[^a-z0-9]/g, "") || "jpg"}`;
  const { error } = await supabase.storage.from(RECEIPTS_BUCKET).upload(path, body, { contentType: mime, upsert: false });
  if (error) throw new Error(error.message);
  return { path, mime };
}

export async function receiptSignedUrl(path: string, seconds = 600): Promise<string | null> {
  const { data } = await supabase.storage.from(RECEIPTS_BUCKET).createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}
