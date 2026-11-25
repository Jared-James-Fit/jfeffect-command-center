import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

const renderVideo = vi.fn();
vi.mock("@/lib/video-edit/render", () => ({
  renderVideo: (...a: unknown[]) => renderVideo(...a),
  VideoRenderError: class extends Error {},
}));

const info = {
  duration: 35.4,
  bytes: 25_400_000,
  width: 1080,
  height: 1920,
  codec: "avc1",
  audioCodec: "mp4a",
  hasAudio: true,
  fps: 30,
  container: "mp4" as const,
};
const file = new File([new Uint8Array(8)], "jf-film-1.mp4", { type: "video/mp4" });

afterEach(() => renderVideo.mockReset());

describe("Save to Photos gets the trimmed part, never the whole recording (phoneCopyFor)", () => {
  it("cuts the selection out without re-encoding (a remux of the recording)", async () => {
    const { phoneCopyFor } = await import("@/lib/set-videos/uploader");
    const cut = new File([new Uint8Array(4)], "jf-film-1-trim.mp4", { type: "video/mp4" });
    renderVideo.mockResolvedValue({ file: cut, mode: "copy", reason: "ok", ms: 400 });
    const out = await phoneCopyFor({ file, info, trim: { start: 11.2, end: 23.2 } });
    expect(out).toBe(cut);
    const [, , plan] = renderVideo.mock.calls[0];
    expect(plan).toMatchObject({ mode: "copy", start: 11.2, end: 23.2 });
  });

  it("nothing trimmed: the recording itself (no work)", async () => {
    const { phoneCopyFor } = await import("@/lib/set-videos/uploader");
    expect(await phoneCopyFor({ file, info, trim: null })).toBe(file);
    expect(await phoneCopyFor({ file, info, trim: { start: 0, end: 35.4 } })).toBe(file);
    expect(renderVideo).not.toHaveBeenCalled();
  });

  it("a phone that can't cut it gets nothing in hand (the stored, trimmed copy is saved instead)", async () => {
    const { phoneCopyFor } = await import("@/lib/set-videos/uploader");
    renderVideo.mockRejectedValue(new Error("no"));
    expect(await phoneCopyFor({ file, info, trim: { start: 2, end: 9 } })).toBeNull();
  });

  it("the copy held after filming is that trimmed copy, never the picked recording", () => {
    const flow = read("src/components/workout-day/set-video-flow.tsx");
    expect(flow).toContain("phoneCopy: forPhone");
    expect(flow).toContain("noteFilmed(start.userId, { jobId, dayId: start.dayId });");
    expect(flow).toContain("if (copy) holdFilmedFile(start.userId, jobId, copy);");
    expect(flow).not.toContain("offerPhoneCopy");
  });
});
