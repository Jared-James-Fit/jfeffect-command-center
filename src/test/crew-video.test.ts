import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_PICK_VIDEO_BYTES, MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS, baseMediaType, checkMediaFile, checkVideoDuration, uploadableVideo } from "@/lib/community";
import { pickRecorderType } from "@/components/community/clip-recorder";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("Crew video: pick it or film it, it's up while you write the caption", () => {
  it("takes a clip up to a minute, and a big one when the phone can shrink it first", () => {
    expect(MAX_VIDEO_SECONDS).toBe(60);
    expect(checkVideoDuration(59.8).ok).toBe(true);
    expect(checkVideoDuration(75).ok).toBe(false);
    // a 4K clip over the storage limit: fine on a phone that can re-encode, not on one that can't
    const big = { type: "video/quicktime", size: MAX_VIDEO_BYTES * 3 };
    expect(checkMediaFile(big, { canShrink: true })).toEqual({ ok: true, kind: "video" });
    expect(checkMediaFile(big).ok).toBe(false);
    expect(checkMediaFile({ type: "video/mp4", size: MAX_PICK_VIDEO_BYTES + 1 }, { canShrink: true }).ok).toBe(false);
    // a clip handed over with no type is still a clip; codec details don't matter
    expect(checkMediaFile({ type: "", size: 1000, name: "IMG_1234.MOV" })).toEqual({ ok: true, kind: "video" });
    expect(checkMediaFile({ type: "video/webm;codecs=vp8,opus", size: 1000 })).toEqual({ ok: true, kind: "video" });
    expect(baseMediaType("video/webm;codecs=vp8,opus")).toBe("video/webm");
  });

  it("sends a clip with a type the storage takes", () => {
    expect(uploadableVideo(new File(["x"], "clip.m4v", { type: "video/x-m4v" })).type).toBe("video/mp4");
    expect(uploadableVideo(new File(["x"], "IMG_1.MOV", { type: "" })).type).toBe("video/quicktime");
    expect(uploadableVideo(new File(["x"], "jf-clip.webm", { type: "video/webm;codecs=vp9,opus" })).type).toBe("video/webm");
    const mp4 = new File(["x"], "a.mp4", { type: "video/mp4" });
    expect(uploadableVideo(mp4)).toBe(mp4);
  });

  it("reads a clip the iPhone way, and never turns one away just because it has no poster frame", () => {
    const media = read("src/lib/community-media.ts");
    expect(media).toContain("await captureVideoPoster(file, { maxDimension: 1080, timeoutMs: 10_000 });");
    expect(media).toContain("const meta = await readVideoMeta(file);");
    expect(media).not.toContain("async function readVideo(url");
  });

  it("uploads the original at once while the phone shrinks a copy; whichever lands first is posted (over the limit: only the copy)", () => {
    const media = read("src/lib/community-media.ts");
    expect(media).toContain("if (m.kind === \"video\") return uploadVideo(m, userId, onProgress);");
    expect(media).toContain("const r = await raceVideoUpload(");
    expect(media).toContain('path = r.sent === "compressed" ? compressedPath : originalPath;');
    expect(media).toContain("// too big to go as it is: shrink first, then send the copy");
    // the poster goes up alongside, not after
    expect(media).toContain("const thumbP: Promise<string | null> = m.thumb");
  });

  it("starts uploading the moment it's picked: the studio's slides and the workout composer's photo or clip", () => {
    expect(read("src/components/community/slide-tray.tsx")).toContain("Each one starts uploading the moment it's");
    const composer = read("src/components/community/share-composer.tsx");
    expect(composer).toContain("const early = useEarlyUpload(media, user?.id);");
    expect(composer).toContain("await early.take(media, setProgress)");
    expect(composer).toContain("early.keep(media);");
    // swapped or closed without posting: thrown away once it lands
    expect(read("src/lib/use-early-upload.ts")).toContain("if (!e.kept) void e.promise.then((up) => removeCommunityFiles([up.media_path, up.media_thumb_path]), () => {});");
  });

  it("films from the camera: tap for a photo, hold for a clip (a plain post), the ring filling to the minute", () => {
    expect(pickRecorderType((t) => t === "video/mp4")).toBe("video/mp4");
    expect(pickRecorderType((t) => t.startsWith("video/webm"))).toBe("video/webm;codecs=vp9,opus");
    expect(pickRecorderType(() => false)).toBeNull();
    const studio = read("src/components/community/share-studio.tsx");
    expect(studio).toContain("const recordable = useMemo(() => canRecordClips(), []) && !card && status === \"live\" && canShoot && count == null;");
    expect(studio).toContain("Tap for a photo, hold for video");
    // the phone's own camera can film too, on a plain post
    expect(studio).toContain('accept={card ? "image/*" : "image/*,video/*"} capture="environment"');
    // the clip plays while you write the caption
    expect(studio).toContain("data-studio-clip");
    const shutter = read("src/components/community/look-carousel.tsx");
    expect(shutter).toContain("holdRef.current?.onStart();");
    expect(shutter).toContain("conic-gradient(rgb(239 68 68)");
    // Normal in the ring of filters films too: the same element keeps the finger (no swap mid-hold)
    expect(shutter).toContain("{...(on ? h.handlers : {})}");
  });

  it("the feed plays a clip muted while it's on screen, sound one tap away; a story plays it whole, its length runs the bar", () => {
    const inline = read("src/components/community/inline-video.tsx");
    expect(inline).toContain("setVisible(!!e && e.intersectionRatio >= 0.6)");
    expect(inline).toContain('v.setAttribute("muted", "")');
    expect(inline).toContain("prefers-reduced-motion: reduce");
    expect(read("src/components/community/post-card.tsx")).toContain("<InlineVideo path={slide.path} poster={thumbUrl} active={active} position={position} />");
    const stories = read("src/components/community/crew-stories.tsx");
    expect(stories).toContain("return <StoryClip path={post.media_path} poster={thumb} {...clip} />;");
    expect(stories).toContain("progressRef.current(v.currentTime / v.duration)");
    expect(stories).toContain("onEnded={() => onEnd()}");
    expect(stories).toContain("Tap for sound");
  });
});
