import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { baseMediaType, checkMediaFile, uploadableVideo } from "@/lib/community";
import { RECORD_MAX_SECONDS, SOURCE_MAX_BYTES } from "@/lib/video-edit/limits";
import { pickRecorderType } from "@/components/community/clip-recorder";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("Crew video: pick it or film it, it's up while you write the caption", () => {
  it("takes any recording off the phone (it's trimmed to fit later); the camera films a story's minute", () => {
    expect(RECORD_MAX_SECONDS).toBe(60);
    // a 4K session far over the storage limit: fine, only the trimmed part uploads
    expect(checkMediaFile({ type: "video/quicktime", size: 2 * 1024 ** 3 })).toEqual({ ok: true, kind: "video" });
    expect(checkMediaFile({ type: "video/mp4", size: SOURCE_MAX_BYTES + 1 }).ok).toBe(false);
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

  it("reads a clip's header first (a long one opens the trimmer), its poster from the first moment of what goes", () => {
    const media = read("src/lib/community-media.ts");
    expect(media).toContain("const picked = await pickVideo(file, context, { trim: opts.trim, step: opts.step });");
    expect(media).toContain("await captureVideoPoster(file, { maxDimension: 1080, timeoutMs: 10_000, at: video.trim?.start ?? null });");
    expect(media).not.toContain("raceVideoUpload");
  });

  it("uploads only the trimmed part, cut and shrunk on the phone, resumably, then checked by the server", () => {
    const media = read("src/lib/community-media.ts");
    expect(media).toContain("if (m.kind === \"video\") return uploadVideo(m, userId, onProgress, signal);");
    expect(media).toContain("createVideoSend({ file: m.file, info: v.info, canEncode: v.canEncode, trim: v.trim, context: v.context, bucket: COMMUNITY_BUCKET, userId, stem })");
    // one send per picked clip: a retry carries on from what's done
    expect(media).toContain("const clipSends = new WeakMap<PickedMedia,");
    const pipe = read("src/lib/video-edit/pipeline.ts");
    expect(pipe).toContain("resume: true,");
    expect(pipe).toContain("verifyVideoUploadFn({");
  });

  it("starts uploading the moment it's picked: the studio's slides and the workout composer's photo or clip", () => {
    expect(read("src/components/community/slide-tray.tsx")).toContain("Each one starts uploading the moment it's");
    const composer = read("src/components/community/share-composer.tsx");
    expect(composer).toContain("const early = useEarlyUpload(media, user?.id);");
    expect(composer).toContain("await early.take(media, setProgress)");
    expect(composer).toContain("early.keep(media);");
    // swapped, re-trimmed or closed without posting: stopped, and thrown away if it landed
    const early = read("src/lib/use-early-upload.ts");
    expect(early).toContain("ctl.abort();");
    expect(early).toContain("void e.promise.then((up) => removeCommunityFiles([up.media_path, up.media_thumb_path]), () => {});");
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

  it("the feed plays a clip muted while it's on screen, sound one tap away; a story plays up to its first minute, its length runs the bar", () => {
    const inline = read("src/components/community/inline-video.tsx");
    expect(inline).toContain("setVisible(!!e && e.intersectionRatio >= 0.6)");
    expect(inline).toContain('v.setAttribute("muted", "")');
    expect(inline).toContain("prefers-reduced-motion: reduce");
    expect(read("src/components/community/post-card.tsx")).toContain("<InlineVideo path={slide.path} poster={thumbUrl} active={active} position={position} />");
    const stories = read("src/components/community/crew-stories.tsx");
    expect(stories).toContain("return <StoryClip path={post.media_path} poster={thumb} {...clip} />;");
    expect(stories).toContain("progressRef.current(Math.min(1, v.currentTime / span));");
    expect(stories).toContain('const STORY_CLIP_MAX_SECONDS = videoLimit("story");');
    expect(stories).toContain("onEnded={() => onEnd()}");
    expect(stories).toContain("Tap for sound");
  });
});
