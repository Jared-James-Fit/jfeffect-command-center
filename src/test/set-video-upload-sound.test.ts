import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The upload sound is the real uploader's, run through its resume path (a
 * clip already uploaded and checked, waiting to be attached): the network,
 * storage and the outbox are stand-ins, the decision is uploader.ts's own.
 * It must sound only for a clip that genuinely landed (attached, on the set
 * and in the coach's chat), once, never for one the server already had,
 * never for a failure or a retry.
 */
const feedback = vi.fn((..._a: unknown[]) => true);
vi.mock("@/lib/feedback", () => ({ feedback: (...a: unknown[]) => feedback(...a) }));
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast }));
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: () => ({}) } }));
vi.mock("@/lib/chat-video-store", () => ({ keepChatVideo: () => {} }));
vi.mock("@/lib/set-videos/server-copy-flag", () => ({ serverCopiesOn: async () => true }));
vi.mock("@/lib/set-videos/phone-copy", () => ({ linkFilmed: () => {} }));
vi.mock("@/lib/lift-analysis/auto", () => ({ queueLiftAnalysis: () => {} }));
vi.mock("@/lib/push/events.functions", () => ({ notifyNewMessage: async () => {} }));
vi.mock("@/lib/video-verify.functions", () => ({ verifyVideoUploadFn: async () => ({ ok: true }) }));
vi.mock("@/lib/lift-video-storage-upload", () => ({ uploadLiftFileToStorage: async () => {}, measuredUplink: () => null }));

const records = new Map<string, any>();
vi.mock("@/lib/set-videos/outbox", () => ({
  outboxPut: async (r: any) => { records.set(r.id, r); return true; },
  outboxGet: async (id: string) => records.get(id) ?? null,
  outboxPatch: async (id: string, p: any) => { records.set(id, { ...records.get(id), ...p }); return true; },
  outboxDelete: async (id: string) => { records.delete(id); },
  outboxForUser: async (u: string) => [...records.values()].filter((r) => r.userId === u),
}));

function waiting(id: string) {
  const meta = {
    id, userId: "u1", clientId: "c1", rowId: "row1", dayId: "d1", resultId: "res1", setIndex: 2,
    exerciseName: "Competition Squat", dayTitle: "Lower", label: "", fileKey: `fk-${id}`, fileName: "IMG_1.MOV", createdAt: Date.now(),
  };
  records.set(id, {
    id, userId: "u1", meta, savedAt: Date.now(),
    file: new Blob([new Uint8Array(16)], { type: "video/mp4" }), fileType: "video/mp4",
    path: `c1/set-videos/${id}.mp4`, uploaded: true,
    check: { duration: 12, width: 720, height: 1280, bytes: 16, mime: "video/mp4" },
  });
}

async function settle() {
  for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout });
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener() {} });
  records.clear();
  feedback.mockClear();
  toast.success.mockClear();
  toast.error.mockClear();
  rpc.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("the upload sound means the footage landed", () => {
  it("a clip attached for the first time: the upload cue once, keyed by the clip, before its toast", async () => {
    vi.resetModules();
    const { resumeSetVideos } = await import("@/lib/set-videos/uploader");
    const { getSetVideoJobs } = await import("@/lib/set-videos/jobs");
    waiting("j1");
    rpc.mockResolvedValue({ data: { id: "sv1", message_id: "m1", existed: false }, error: null });
    await resumeSetVideos("u1");
    await settle();
    expect(getSetVideoJobs().find((j) => j.id === "j1")?.state).toBe("done");
    const uploads = feedback.mock.calls.filter((c) => c[0] === "upload");
    expect(uploads).toEqual([["upload", { key: "j1" }]]);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(feedback.mock.invocationCallOrder[feedback.mock.calls.findIndex((c) => c[0] === "upload")]).toBeLessThan(toast.success.mock.invocationCallOrder[0]);
  });

  it("a clip the server already had (a resend after a lost answer): no cue, no toast", async () => {
    vi.resetModules();
    const { resumeSetVideos } = await import("@/lib/set-videos/uploader");
    waiting("j2");
    rpc.mockResolvedValue({ data: { id: "sv2", message_id: "m2", existed: true }, error: null });
    await resumeSetVideos("u1");
    await settle();
    expect(feedback.mock.calls.filter((c) => c[0] === "upload")).toEqual([]);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("a refused attach (not this athlete's set): no upload cue, the failure is said once", async () => {
    vi.resetModules();
    const { resumeSetVideos } = await import("@/lib/set-videos/uploader");
    const { getSetVideoJobs } = await import("@/lib/set-videos/jobs");
    waiting("j3");
    rpc.mockResolvedValue({ data: null, error: { message: "Not allowed" } });
    await resumeSetVideos("u1");
    await settle();
    expect(getSetVideoJobs().find((j) => j.id === "j3")?.state).toBe("failed");
    expect(feedback.mock.calls.filter((c) => c[0] === "upload")).toEqual([]);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});
