import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("fast media upload paths", () => {
  const storage = readFileSync("src/lib/lift-video-storage-upload.ts", "utf8");
  // Chat uploads: shared uploader (compression) + background draft queue (concurrency, progress).
  const chatUpload = readFileSync("src/components/chat-shared.tsx", "utf8");
  const draftUploads = readFileSync("src/hooks/use-draft-uploads.ts", "utf8");
  const progress = readFileSync("src/components/progress/progress-section.tsx", "utf8");
  const progressLib = readFileSync("src/lib/progress.ts", "utf8");

  it("uses one direct storage request for small media and TUS only for larger files", () => {
    expect(storage).toContain("DIRECT_UPLOAD_MAX_BYTES = 6 * 1024 * 1024");
    expect(storage).toContain("uploadDirectWithProgress");
    expect(storage).toContain('xhr.open("POST"');
    expect(storage).toContain('new tus.Upload');
  });

  it("shows upload feedback immediately", () => {
    expect(storage).toContain("args.onProgress?.(1)");
    expect(draftUploads).toContain("store.set(id, 1)");
    expect(progress).toContain("requestAnimationFrame");
    expect(progress).toContain('"Preparing…"');
  });

  it("compresses chat photos and uploads multiple attachments with bounded concurrency", () => {
    expect(chatUpload).toContain("compressImage(file");
    expect(draftUploads).toContain("const MAX_PARALLEL = 2;");
    expect(draftUploads).toContain("while (active < maxParallel && waiting.length)");
  });

  it("starts progress storage and submission work concurrently", () => {
    expect(progress).toContain("const subPromise = getSubId()");
    expect(progress).toContain("const uploadPromise = uploadProgressFile");
    expect(progress).toContain("Promise.all([subPromise, uploadPromise])");
  });

  it("reuses the hybrid uploader for progress photos and videos", () => {
    expect(progressLib).toContain('bucket: "progress-media"');
    expect(progressLib).toContain("uploadLiftFileToStorage");
    expect(progressLib).not.toContain('endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`');
  });
});
