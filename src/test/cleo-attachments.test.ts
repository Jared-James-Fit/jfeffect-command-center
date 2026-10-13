/**
 * Cleo attachments: what can be attached, how a video becomes stills, that
 * only the sender's own files are ever read, and that files go when their
 * message goes.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { AttachmentsInput, attachmentKind, attachmentLabel, attachmentPaths, frameTimes, MAX_FRAMES, MIN_FRAMES } from "@/lib/cleo-attachments";

const me = "0076110b-cd9c-4459-9ac4-42df8bee5ca5";

describe("what can be attached", () => {
  it("knows photos, videos, PDFs and text files, by type or extension", () => {
    expect(attachmentKind("image/jpeg", "a.jpg")).toBe("image");
    expect(attachmentKind("", "IMG_0042.HEIC")).toBe("image");
    expect(attachmentKind("video/quicktime", "squat.mov")).toBe("video");
    expect(attachmentKind("application/pdf", "bloodwork.pdf")).toBe("pdf");
    expect(attachmentKind("", "macros.csv")).toBe("text");
    expect(attachmentKind("application/zip", "stuff.zip")).toBeNull();
  });

  it("labels them plainly", () => {
    expect(attachmentLabel({ kind: "video", name: "squat.mov", duration: 14.2 })).toBe("squat.mov (video, 0:14)");
    expect(attachmentLabel({ kind: "image", name: "meal.jpg" })).toBe("meal.jpg (photo)");
  });
});

describe("video stills", () => {
  it("about one a second, 6 to 16, spread across the clip and never at the very ends", () => {
    expect(frameTimes(3)).toHaveLength(MIN_FRAMES);
    expect(frameTimes(10)).toHaveLength(10);
    expect(frameTimes(300)).toHaveLength(MAX_FRAMES);
    const t = frameTimes(12);
    expect(t[0]).toBeGreaterThan(0);
    expect(t[t.length - 1]).toBeLessThan(12);
    expect([...t].sort((a, b) => a - b)).toEqual(t);
  });
});

describe("only your own files", () => {
  it("accepts paths in a person's folder and refuses anything that climbs out", () => {
    const ok = AttachmentsInput.safeParse([{ kind: "image", name: "a.jpg", mime: "image/jpeg", size: 1000, path: `${me}/2026-10/x.jpg` }]);
    expect(ok.success).toBe(true);
    expect(AttachmentsInput.safeParse([{ kind: "image", name: "a.jpg", mime: "image/jpeg", size: 1000, path: `${me}/../other/x.jpg` }]).success).toBe(false);
    expect(AttachmentsInput.safeParse([{ kind: "image", name: "a.jpg", mime: "image/jpeg", size: 1000, path: "receipts/x.jpg" }]).success).toBe(false);
    expect(AttachmentsInput.safeParse(Array.from({ length: 6 }, () => ({ kind: "pdf", name: "a.pdf", mime: "application/pdf", size: 1 }))).success).toBe(false);
  });

  it("the server refuses another person's folder before reading anything", async () => {
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
    const { assertOwnAttachments } = await import("@/lib/cleo-attachments.server");
    expect(() => assertOwnAttachments(me, [{ kind: "image", name: "a", mime: "image/jpeg", size: 1, path: `${me}/2026-10/a.jpg` }])).not.toThrow();
    expect(() =>
      assertOwnAttachments(me, [{ kind: "video", name: "v", mime: "video/mp4", size: 1, frames: [{ path: "11111111-1111-4111-8111-111111111111/2026-10/v/f01.jpg", t: 1 }] }]),
    ).toThrow(/isn't yours/);
  });

  it("every stored file is accounted for (the clip and its stills)", () => {
    expect(attachmentPaths({ path: "a/b.mp4", frames: [{ path: "a/b/f01.jpg", t: 0.5 }, { path: "a/b/f02.jpg", t: 1.5 }] })).toEqual(["a/b.mp4", "a/b/f01.jpg", "a/b/f02.jpg"]);
  });
});

describe("wiring", () => {
  const server = readFileSync("src/lib/summer.server.ts", "utf8");
  const chats = readFileSync("src/lib/cleo-chats.server.ts", "utf8");
  const sql = readFileSync("supabase/migrations/20261120090000_cleo_attachments.sql", "utf8");
  const chat = readFileSync("src/components/admin/books/summer-chat.tsx", "utf8");

  it("Cleo sees the files with the question, keeps what it read, and the files belong to the message", () => {
    expect(server).toContain("files.assertOwnAttachments(userId, attachments)");
    expect(server).toContain("...read.images.slice(0, 24)");
    expect(server).toContain("attachments: read?.saved.length ? read.saved : null");
    expect(server).toContain("await files.linkAttachments(userId, user.id, read.saved)");
  });

  it("files go with their chat, and a daily sweep catches the rest", () => {
    expect(chats).toContain("removeAttachmentFiles(paths)");
    expect(sql).toContain("references public.summer_messages (id) on delete set null");
    expect(sql).toContain("cron.schedule('cleo-attachments-sweep'");
    expect(sql).toContain("(storage.foldername(name))[1] = (select auth.uid())::text");
  });

  it("the composer has an attach button, a tray, and pasted screenshots go in it", () => {
    expect(chat).toContain('aria-label="Attach photos, videos or files"');
    expect(chat).toContain("<AttachmentTray");
    expect(chat).toContain("tray.add(pasted)");
  });
});
