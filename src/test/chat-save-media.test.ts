import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signed: string[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({
        createSignedUrl: async (p: string) => { signed.push(p); return { data: { signedUrl: `https://cdn.test/sign/${p}` }, error: null }; },
      }),
    },
  },
}));
const local = new Map<string, string>();
vi.mock("@/lib/chat-video-store", () => ({ peekChatVideo: (p?: string | null) => (p ? local.get(p) : undefined) }));

const lib = await import("@/lib/save-media");
const { saveItemsOf, saveLabel, saveFileName, saveMime, prepareSave, readyFiles, saveFiles, warmSave, _resetSaveMedia } = lib;

const read = (p: string) => readFileSync(p, "utf8");

function okResponse(body: string, type: string) {
  return new Response(new Blob([body], { type }), { status: 200, headers: { "content-type": type, "content-length": String(body.length) } });
}

describe("what can be saved from a message", () => {
  it("its photos and videos, not GIFs, sound effects, files or links", () => {
    const items = saveItemsOf([
      { type: "image", storage_path: "c1/a.jpg", name: "IMG_1.JPG" },
      { type: "video", storage_path: "c1/b.mov", url: "" },
      { type: "image", kind: "gif", url: "https://tenor/x.gif" },
      { type: "audio", kind: "sound", url: "https://x/s.mp3" },
      { type: "pdf", storage_path: "c1/c.pdf" },
      { type: "link", url: "https://x" },
      null,
    ], { at: "2026-10-27T10:00:00Z", signed: { "c1/a.jpg": "https://cdn.test/on-screen/a.jpg" } });
    expect(items).toEqual([
      { kind: "image", path: "c1/a.jpg", url: "https://cdn.test/on-screen/a.jpg", name: "IMG_1.JPG", mime: null, at: "2026-10-27T10:00:00Z" },
      { kind: "video", path: "c1/b.mov", url: null, name: null, mime: null, at: "2026-10-27T10:00:00Z" },
    ]);
    expect(saveItemsOf(null)).toEqual([]);
  });

  it("says what it saves", () => {
    expect(saveLabel([{ kind: "image" }])).toBe("Save photo");
    expect(saveLabel([{ kind: "video" }])).toBe("Save video");
    expect(saveLabel([{ kind: "image" }, { kind: "image" }])).toBe("Save 2 photos");
    expect(saveLabel([{ kind: "video" }, { kind: "video" }, { kind: "video" }])).toBe("Save 3 videos");
    expect(saveLabel([{ kind: "image" }, { kind: "video" }])).toBe("Save 2 photos & videos");
  });

  it("names and types the file so Photos takes it (Save Image / Save Video)", () => {
    expect(saveMime({ kind: "video", path: "c1/b.mov" }, "video/quicktime")).toBe("video/quicktime");
    expect(saveMime({ kind: "video", path: "c1/b.mov" }, "application/octet-stream")).toBe("video/quicktime");
    expect(saveMime({ kind: "image", path: "c1/x" }, "")).toBe("image/jpeg");
    expect(saveMime({ kind: "video", url: "https://x/y?token=1" }, null)).toBe("video/mp4");
    expect(saveFileName({ kind: "image", name: "IMG_2041.JPG" }, 0, "image/jpeg")).toBe("IMG_2041.JPG");
    expect(saveFileName({ kind: "video", name: "squat", at: "2026-10-27T10:00:00Z" }, 1, "video/mp4")).toBe("jfeffect-2026-10-27-2.mp4");
    expect(saveFileName({ kind: "image", name: 'a/b:c.png' }, 0, "image/png")).toBe("a-b-c.png");
  });
});

describe("getting the files in hand", () => {
  beforeEach(() => { _resetSaveMedia(); signed.length = 0; local.clear(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("uses the link on screen first, signs a fresh one only if that fails, and keeps the file for the tap", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("expired") ? new Response("", { status: 400 }) : okResponse("jpegbytes", "image/jpeg"));
    vi.stubGlobal("fetch", fetchMock);
    const items = [{ kind: "image" as const, path: "c1/a.jpg", url: "https://cdn.test/expired/a.jpg", at: "2026-10-27T10:00:00Z" }];
    expect(readyFiles(items)).toBeNull();
    const [file] = await prepareSave(items);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["https://cdn.test/expired/a.jpg", "https://cdn.test/sign/c1/a.jpg"]);
    expect(file.type).toBe("image/jpeg");
    expect(file.name).toBe("jfeffect-2026-10-27-1.jpg");
    // the tap: in hand synchronously, nothing fetched again
    expect(readyFiles(items)?.[0]).toBe(file);
    await prepareSave(items);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a clip already on the phone for playback is used as is (no download, no signing)", async () => {
    local.set("c1/b.mp4", "blob:local-b");
    const fetchMock = vi.fn(async (_url: unknown) => okResponse("mp4bytes", "video/mp4"));
    vi.stubGlobal("fetch", fetchMock);
    await prepareSave([{ kind: "video", path: "c1/b.mp4" }]);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["blob:local-b"]);
    expect(signed).toEqual([]);
  });

  it("touch-down and tap share one download; a cheap warm-up skips videos that aren't on the phone", async () => {
    const fetchMock = vi.fn(async () => okResponse("x", "image/jpeg"));
    vi.stubGlobal("fetch", fetchMock);
    const photo = { kind: "image" as const, url: "https://cdn.test/p.jpg" };
    const clip = { kind: "video" as const, path: "c1/big.mp4" };
    warmSave([clip], { cheap: true });
    expect(fetchMock).not.toHaveBeenCalled();
    warmSave([photo]);
    await prepareSave([photo]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports download progress for a long video", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse("x".repeat(1000), "video/mp4")));
    const seen: number[] = [];
    await prepareSave([{ kind: "video", url: "https://cdn.test/v.mp4" }], (p) => seen.push(p));
    expect(seen.at(-1)).toBe(1);
  });
});

describe("handing them over", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const files = [new File(["x"], "a.jpg", { type: "image/jpeg" })];
  const phone = (share: (d: unknown) => Promise<void>) =>
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", maxTouchPoints: 5, share, canShare: () => true });

  it("a phone opens the share sheet with the files (Save Image / Save Video live there)", async () => {
    const share = vi.fn(async () => {});
    phone(share);
    expect(await saveFiles(files)).toBe("shared");
    expect(share).toHaveBeenCalledWith({ files });
  });

  it("closing the sheet is fine; a refused sheet (the tap's moment passed) means one more tap", async () => {
    phone(async () => { throw Object.assign(new Error("x"), { name: "AbortError" }); });
    expect(await saveFiles(files)).toBe("cancelled");
    phone(async () => { throw Object.assign(new Error("x"), { name: "NotAllowedError" }); });
    expect(await saveFiles(files)).toBe("again");
  });
});

describe("where Save is", () => {
  it("beside media someone sent you, in both chats (not your own, not while editing or selecting)", () => {
    for (const f of ["src/components/message-thread.tsx", "src/components/group-message-thread.tsx"]) {
      const t = read(f);
      expect(t, f).toContain("{!mine && !isDeleted && !isEditing && !selectionMode");
      expect(t, f).toContain("<SaveMediaButton items={saveItemsOf(m.attachments, { at: m.created_at");
      expect(t, f).toContain('data-testid="save-media"');
    }
  });

  it("in a held message's menu: the one photo / video held, else all of them", () => {
    const t = read("src/components/message-thread.tsx");
    expect(t).toContain("const heldAtt = sheetClip != null ? m.attachments?.[sheetClip] : undefined;");
    expect(t).toContain("warmSave(saveItemsOf(m.attachments, { at: m.created_at, signed: signedUrlMap }), { cheap: true });");
  });

  it("in the full-screen viewer for chat photos and videos only, and the viewer stays light", () => {
    const viewer = read("src/components/media-viewer.tsx");
    expect(viewer).toContain("{state.save && <ViewerSaveButton item={state.save} />}");
    expect(viewer).not.toContain("instagram-export");
    expect(read("src/lib/save-media.ts")).toContain('from "@/lib/file-share"');
    expect(read("src/components/chat-media-attachment.tsx")).toContain('save: { kind: "image", path: att.storage_path ?? null, url: fullSrc');
    expect(read("src/components/chat-video-tile.tsx")).toContain('save: { kind: "video", path: path ?? null, url: src ?? null, name: name ?? null }');
  });
});
