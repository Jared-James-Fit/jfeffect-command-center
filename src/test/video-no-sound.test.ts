import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AUDIO_BITRATE, planVideo, type SourceInfo } from "@/lib/video-edit/plan";
import { clipIsSilent } from "@/lib/video-silent";
import { withSound, type PickedMedia } from "@/lib/community-media";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const MB = 1024 * 1024;
const clip = (seconds: number, over: Partial<SourceInfo> = {}): SourceInfo => ({
  duration: seconds,
  bytes: Math.round(seconds * 0.15 * MB),
  width: 720,
  height: 1280,
  codec: "avc",
  audioCodec: "aac",
  hasAudio: true,
  fps: 30,
  container: "mp4",
  ...over,
});
const heavy = (seconds: number): SourceInfo => clip(seconds, { bytes: Math.round(seconds * 1.9 * MB), width: 1080, height: 1920, codec: "hevc", container: "mov" });

describe("posted with no sound: the audio track never leaves the phone", () => {
  it("a clip that would go as it is goes as a copy without its sound (a remux, ~instant)", () => {
    expect(planVideo(clip(20), null, "post", { canEncode: true })).toEqual({ mode: "original" });
    expect(planVideo(clip(20), null, "post", { canEncode: true, muted: true })).toEqual({ mode: "copy", start: 0, end: 20, estBytes: clip(20).bytes, muted: true });
    // a phone that can't re-encode can still leave the sound out
    expect(planVideo(clip(20), null, "post", { canEncode: false, muted: true })).toMatchObject({ mode: "copy", muted: true });
  });

  it("a cut or a re-encode leaves it out too, and a re-encode spends its bits on the picture", () => {
    expect(planVideo(clip(20), { start: 2, end: 12 }, "post", { canEncode: true, muted: true })).toMatchObject({ mode: "copy", start: 2, end: 12, muted: true });
    const loud = planVideo(heavy(170), null, "post", { canEncode: true });
    const quiet = planVideo(heavy(170), null, "post", { canEncode: true, muted: true });
    expect(loud.mode).toBe("transcode");
    expect(quiet).toMatchObject({ mode: "transcode", muted: true });
    if (loud.mode === "transcode" && quiet.mode === "transcode") {
      expect(quiet.videoBitrate).toBeGreaterThanOrEqual(loud.videoBitrate);
      expect(quiet.estBytes).toBeLessThanOrEqual(loud.estBytes + 1);
      expect(AUDIO_BITRATE).toBeGreaterThan(0);
    }
  });

  it("a clip with no sound to begin with, or one it refuses, is untouched", () => {
    expect(planVideo(clip(20, { hasAudio: false, audioCodec: null }), null, "post", { canEncode: true, muted: true })).toEqual({ mode: "original" });
    expect(planVideo(clip(200), null, "story", { canEncode: true, muted: true }).mode).toBe("reject");
  });

  it("the render drops the track only when asked, and never calls a dropped track a failure then", () => {
    const r = read("lib/video-edit/render.ts");
    expect(r).toContain("...(p.muted ? { audio: { discard: true } } : {})");
    expect(r).toContain("audio: t.muted ? { discard: true } :");
    expect(r).toContain("(info.hasAudio && !p.muted && !kept.some((t) => t.type === \"audio\"))");
    // a slow re-encode that falls back to the whole clip never sends the original (it has the sound)
    expect(r).toContain("if (whole && !plan.muted) return done(normalizeVideoType(file), \"original\", why);");
    expect(read("lib/video-edit/pipeline.ts")).toContain("planVideo(o.info, o.trim, o.context, { canEncode: o.canEncode, muted: o.muted })");
    expect(read("lib/community-media.ts")).toContain("trim: v.trim, context: v.context, bucket: COMMUNITY_BUCKET, userId, stem, muted: v.muted })");
  });
});

describe("withSound: the same clip, its own upload, the same preview", () => {
  const picked = (over: Partial<NonNullable<PickedMedia["video"]>> = {}): PickedMedia =>
    ({
      kind: "video",
      file: new File([], "a.mov"),
      previewUrl: "blob:x",
      drawable: {} as HTMLCanvasElement,
      width: 720,
      height: 1280,
      thumb: null,
      video: { file: new File([], "a.mov"), info: clip(20), canEncode: true, trim: null, context: "post", ...over },
    }) as PickedMedia;

  it("a new object (so a new upload) sharing the preview, the poster and the trim", () => {
    const m = picked({ trim: { start: 1, end: 9 } });
    const off = withSound(m, false)!;
    expect(off).not.toBe(m);
    expect(off.previewUrl).toBe(m.previewUrl);
    expect(off.drawable).toBe(m.drawable);
    expect(off.video).toMatchObject({ muted: true, trim: { start: 1, end: 9 } });
    expect(withSound(off, true)!.video?.muted).toBe(false);
  });

  it("nothing to change: already that way, a photo, or a clip with no sound", () => {
    expect(withSound(picked(), true)).toBeNull();
    expect(withSound(picked({ muted: true }), false)).toBeNull();
    expect(withSound(picked({ info: clip(20, { hasAudio: false }) }), false)).toBeNull();
    expect(withSound({ ...picked(), kind: "image", video: undefined }, false)).toBeNull();
  });
});

describe("a clip with no sound reads as silent, never on a guess", () => {
  const base = { muted: false, currentTime: 0, readyState: 4 };
  it("Safari and the iPhone app list the tracks", () => {
    expect(clipIsSilent({ ...base, audioTracks: { length: 0 } })).toBe(true);
    expect(clipIsSilent({ ...base, audioTracks: { length: 1 } })).toBe(false);
  });
  it("Firefox says so", () => {
    expect(clipIsSilent({ ...base, mozHasAudio: false })).toBe(true);
    expect(clipIsSilent({ ...base, mozHasAudio: true })).toBe(false);
  });
  it("Chrome only from what it decoded, playing with sound a second in", () => {
    expect(clipIsSilent({ ...base, webkitAudioDecodedByteCount: 2048 })).toBe(false);
    expect(clipIsSilent({ ...base, currentTime: 0.4, webkitAudioDecodedByteCount: 0 })).toBeNull();
    expect(clipIsSilent({ ...base, muted: true, currentTime: 3, webkitAudioDecodedByteCount: 0 })).toBeNull();
    expect(clipIsSilent({ ...base, currentTime: 1.5, webkitAudioDecodedByteCount: 0 })).toBe(true);
  });
  it("nothing read yet, or nothing to go on: unknown", () => {
    expect(clipIsSilent({ ...base, readyState: 0, audioTracks: { length: 0 } })).toBeNull();
    expect(clipIsSilent(base)).toBeNull();
  });
});

describe("where it shows", () => {
  it("the studio: one speaker beside Trim, said in the middle, the stage plays it with sound from the tap", () => {
    const s = read("components/community/share-studio.tsx");
    expect(s).toContain("data-studio-sound={trimClip.muted ? \"off\" : \"on\"}");
    expect(s).toContain("trimClip.audio && !trimClip.existing");
    expect(s).toContain("tray.setSound(trimClip.id, on);");
    expect(s).toContain("flashSound(on);");
    expect(s).toContain("sound: hear && !selItem.muted");
    expect(s).toContain("sound={hear && !clip0.muted}");
    const tray = read("components/community/slide-tray.tsx");
    // only the upload changes: the same preview, cover, framing and trim (never itemFields, never released)
    expect(tray).toContain('patch(id, { muted: !on, slide: null, status: "preparing", progress: 0 });');
    expect(tray).toContain("data-tray-muted");
  });

  it("the workout composer: the same speaker beside its Trim", () => {
    const c = read("components/community/share-composer.tsx");
    expect(c).toContain("data-composer-sound");
    expect(c).toContain("withSound(prev, !!prev.video?.muted) ?? prev");
  });

  it("the feed: a silent clip has no speaker or Tap for sound, and a tap on its screen just says no sound", () => {
    const v = read("components/community/inline-video.tsx");
    expect(v).toContain("const askTap = sound && blocked && !silent && controls !== \"corner\";");
    expect(v).toContain("(auto || tapped) && !failed && !silent &&");
    expect(v).toContain('data-silent={silent ? "" : undefined}');
    const card = read("components/community/post-card.tsx");
    expect(card).toContain('if (clip.hasAttribute("data-silent")) {');
  });
});
