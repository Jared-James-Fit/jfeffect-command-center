import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DIGITAL_ZOOM_MAX, LOCK_SLIDE_PX, ZOOM_DEAD_PX, ZOOM_SLIDE_PX, digitalZoomRange, easeZoom, lockReach, slideLocks, zoomCrop, zoomDetent, zoomFromPinch, zoomFromSlide, zoomLabel, zoomRange, type ZoomRange } from "@/lib/camera/camera-zoom";
import { studioCameraAsk } from "@/lib/camera/camera-prime";

/**
 * The Crew camera (Nov 23 2026): a story's camera is 9:16 and what's shot or
 * filmed is exactly what the viewfinder showed; the camera's own zoom by
 * pinching or sliding up while filming; slide left to lock a clip.
 */
const read = (p: string) => readFileSync(p, "utf8");
const studio = read("src/components/community/share-studio.tsx");

describe("the story camera asks for a 9:16 picture", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("a phone held upright asks 1080p at 9:16 (one way round or the other), never the old 4:3", () => {
    const mm = (q: string) => ({ matches: q.includes("coarse"), addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal("screen", { width: 390, height: 844, orientation: { type: "portrait-primary", angle: 0 } });
    vi.stubGlobal("window", { matchMedia: mm, orientation: 0 });
    const ask = studioCameraAsk("environment", "portrait");
    expect(ask.width).toEqual({ ideal: 1080 });
    expect(ask.height).toEqual({ ideal: 1920 });
    const other = studioCameraAsk("environment", "landscape");
    expect(other.width).toEqual({ ideal: 1920 });
    expect(other.height).toEqual({ ideal: 1080 });
  });
  it("a tablet or computer keeps the 4:3 ask (a landscape webcam keeps more of its height under the 9:16 crop)", () => {
    vi.stubGlobal("screen", { width: 1440, height: 900, orientation: { type: "landscape-primary", angle: 0 } });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }), orientation: 0 });
    expect(studioCameraAsk("user")).toEqual({ facingMode: { ideal: "user" }, width: { ideal: 1920 }, height: { ideal: 1440 } });
  });
  it("checks the picture it got, asks the other way once, and remembers what worked (the set camera's rule)", () => {
    expect(studio).toContain("const pic = await pictureSize(video, PICTURE_WAIT_MS);");
    expect(studio).toContain("if (pic) saveFilmAsk(shapes[0]);");
    expect(studio).toContain("const other = await reopen(shapes[1]);");
    expect(studio).toContain("if (pictureFits(pic2.w, pic2.h, upright)) saveFilmAsk(shapes[1]);");
    // the closer one when neither is 9:16: never no camera because of the shape
    expect(studio).toContain("return reopen(shapes[0]);");
  });
  it("a shot or a clip from the camera starts framed exactly as the viewfinder showed it", () => {
    // a camera photo never starts "whole" over a blur on a story
    expect(studio).toContain("setShotWhole(story && !reply && !share && !s.live && storyStartsWhole(drawableSize(s.src as Drawable)));");
    // a clip: filling the story, framed by the camera's guide on a post (never re-decided from its 3:4 shape)
    expect(studio).toContain("const place = { whole: false, framing: !v || story ? CENTRED : framingFromGuide({ w: v.w, h: v.h }, v.view, v.guide) };");
    expect(read("src/components/community/slide-tray.tsx")).toContain("async (files: File[], place?: { framing?: Framing | null; whole?: boolean }) => {");
  });
  it("the viewfinder shows once it's measured (no box that jumps to full screen), and a flip holds the last frame", () => {
    expect(studio).toContain('visibility: phase === "shoot" && !measured ? "hidden" : undefined');
    expect(studio).toContain("data-camera-still");
    expect(studio).toContain("holdStill();");
  });
});

describe("zoom: the camera's own, else a digital zoom that's filmed too", () => {
  const r: ZoomRange = { min: 1, max: 8, now: 1 };
  it("is offered only when the track has a zoom range", () => {
    const track = (caps: unknown, zoom?: number) => ({ getCapabilities: () => caps, getSettings: () => ({ zoom }) }) as unknown as MediaStreamTrack;
    expect(zoomRange(track({}))).toBeNull();
    expect(zoomRange(track({ zoom: { min: 1, max: 1 } }))).toBeNull();
    expect(zoomRange(track({ zoom: { min: 1, max: 30 } }, 2))).toEqual({ min: 1, max: 10, now: 2 });
    expect(zoomRange(null)).toBeNull();
  });
  it("sliding up while filming zooms in, down zooms back out, a wobble does nothing", () => {
    expect(zoomFromSlide(1, -(ZOOM_DEAD_PX - 1), r)).toBe(1);
    const up = zoomFromSlide(1, -200, r);
    expect(up).toBeGreaterThan(1.5);
    expect(zoomFromSlide(1, -2000, r)).toBe(8);
    expect(zoomFromSlide(4, 2000, r)).toBe(1);
    expect(zoomFromSlide(up, 0, r)).toBe(up);
  });
  it("the slide is continuous (never steps), up and down again lands where it started, and the room below reaches the widest", () => {
    // every pixel moves it: no tenth-of-a-zoom steps
    const a = zoomFromSlide(1, -100, r);
    const b = zoomFromSlide(1, -101, r);
    expect(b).toBeGreaterThan(a);
    expect(b - a).toBeLessThan(0.05);
    // zoomed in from 4×, the thumb only has ~90px below the shutter: that's enough to come all the way out
    expect(zoomFromSlide(4, 90, r, 100)).toBe(1);
    expect(zoomFromSlide(4, 50, r, 100)).toBeGreaterThan(1);
    expect(zoomFromSlide(4, 50, r, 100)).toBeLessThan(4);
    // repeated up and down from the same start: the same finger height, the same zoom
    expect(zoomFromSlide(2, -150, r, 100)).toBe(zoomFromSlide(2, -150, r, 100));
    expect(zoomFromSlide(2, -(ZOOM_SLIDE_PX + ZOOM_DEAD_PX), r)).toBeCloseTo(Math.min(8, 2 * 8), 1);
  });
  it("the zoom glides to where the finger is: frame-rate independent, landing exactly", () => {
    // a 120 Hz phone's two frames cover what a 60 Hz phone's one does
    const at60 = easeZoom(1, 3, 16);
    const at120 = easeZoom(easeZoom(1, 3, 8), 3, 8);
    expect(at120).toBeCloseTo(at60, 6);
    let z = 1;
    for (let i = 0; i < 60; i++) z = easeZoom(z, 3, 16);
    expect(z).toBe(3);
    // never overshoots, never jumps past a long pause
    expect(easeZoom(1, 3, 10_000)).toBeLessThan(3);
  });
  it("a light tick at each whole step and at either end, never in between", () => {
    expect(zoomDetent(1.9, 2.05, r)).toBe(true);
    expect(zoomDetent(2.1, 2.4, r)).toBe(false);
    expect(zoomDetent(7.9, 8, r)).toBe(true);
    expect(zoomDetent(1.2, 1, r)).toBe(true);
    expect(zoomDetent(2, 2, r)).toBe(false);
  });
  it("without the camera's own zoom: a digital zoom to 3×, cropped from the middle exactly as the preview scales it", () => {
    expect(digitalZoomRange()).toEqual({ min: 1, max: DIGITAL_ZOOM_MAX, now: 1, digital: true });
    // the whole picture at 1×; the middle half each way at 2×
    expect(zoomCrop(1080, 1920, 1080, 1920, 1)).toEqual({ sx: 0, sy: 0, sw: 1080, sh: 1920 });
    expect(zoomCrop(1080, 1920, 1080, 1920, 2)).toEqual({ sx: 270, sy: 480, sw: 540, sh: 960 });
    // a 4:3 camera into a 9:16 output: cut to the output's shape first, then zoomed from its middle
    const c = zoomCrop(1440, 1080, 1080, 1920, 1);
    expect(c.sw / c.sh).toBeCloseTo(1080 / 1920, 5);
    expect(c.sx + c.sw / 2).toBeCloseTo(720, 5);
    expect(zoomCrop(1080, 1920, 1080, 1920, 0)).toEqual({ sx: 0, sy: 0, sw: 1080, sh: 1920 });
  });
  it("a digital zoom is filmed: the clip records a canvas cropped the same way, never only the preview zoomed", () => {
    const rec = read("src/components/community/clip-recorder.ts");
    expect(rec).toContain("const comp = dz ? startZoomCompositor(dz.video, dz.zoom, Math.round(fps) || 30) : null;");
    expect(rec).toContain("const mixed = new MediaStream([...(comp ? [comp.track] : stream.getVideoTracks()), ...(audio?.getAudioTracks() ?? [])]);");
    const comp = read("src/lib/camera/zoom-compositor.ts");
    expect(comp).toContain("const c = zoomCrop(w, h, canvas.width, canvas.height, zoom());");
    expect(comp).toContain("ctx.drawImage(video, c.sx, c.sy, c.sw, c.sh, 0, 0, canvas.width, canvas.height);");
    expect(studio).toContain("if (zoomCapsRef.current?.digital) return { video: v, zoom: () => zoomNow.current };");
    // a 4K camera films through the same canvas at zoom 1, drawn down to 1080p
    expect(studio).toContain("return needsDownscale(v.videoWidth, v.videoHeight) ? { video: v, zoom: () => 1 } : null;");
    expect(studio).toContain("resetZoom(zoomRange(stream.getVideoTracks()[0]) ?? (canRecordCanvas() ? digitalZoomRange() : null));");
    // the preview scales from its middle; a photo takes the same part at full size
    expect(studio).toContain("v.style.transform = zoomCapsRef.current?.digital && z > 1.0005 ? `scale(${z})` : \"\";");
    expect(studio).toContain("const cr = zoomCrop(video.videoWidth, video.videoHeight, c.width, c.height, zoomCaps?.digital ? zoomNow.current : 1);");
  });
  it("the camera's own zoom: one request at a time, the newest value once the last lands (a fast slide never queues up)", () => {
    expect(studio).toContain("if (nativeBusy.current || nativeSent.current === z) return;");
    expect(studio).toContain("if (nativeSent.current !== zoomNow.current) runZoom();");
    // Chrome on Android shows it only when asked, and it's asked only when that adds no question
    const prime = read("src/lib/camera/camera-prime.ts");
    expect(prime).toContain('ptzAsk = ptz.state === "granted" || cam.state === "prompt";');
    expect(prime).toContain("return ptzAsk ? ({ ...ask, zoom: true } as MediaTrackConstraints) : ask;");
  });
  it("a pinch follows the fingers, held to the range", () => {
    expect(zoomFromPinch(1, 100, 200, r)).toBe(2);
    expect(zoomFromPinch(2, 200, 100, r)).toBe(1);
    expect(zoomFromPinch(1, 100, 5000, r)).toBe(8);
  });
  it("says the zoom only past the widest", () => {
    expect(zoomLabel(1, r)).toBeNull();
    expect(zoomLabel(2.4, r)).toBe("2.4×");
    expect(zoomLabel(2, null)).toBeNull();
  });
});

describe("hold to film, slide left to lock", () => {
  it("locks only on a clear slide to the left, the lock glowing as the finger nears it", () => {
    expect(slideLocks(-LOCK_SLIDE_PX - 1, 4)).toBe(true);
    expect(slideLocks(-30, 0)).toBe(false);
    expect(slideLocks(-LOCK_SLIDE_PX - 10, -200)).toBe(false); // mostly up: that's a zoom
    expect(slideLocks(LOCK_SLIDE_PX + 10, 0)).toBe(false);
    expect(lockReach(-LOCK_SLIDE_PX / 2, 0)).toBeCloseTo(0.5, 5);
    expect(lockReach(-30, -200)).toBe(0); // a zoom never lights the lock
    expect(lockReach(40, 0)).toBe(0);
  });
  it("the finger is followed anywhere on the screen by its id: zoom from where filming started, lock, a lift ends it", () => {
    const carousel = read("src/components/community/look-carousel.tsx");
    // the window follows the finger (the shutter keeps it too), so it can leave the button
    expect(carousel).toContain('window.addEventListener("pointermove", move, true);');
    expect(carousel).toContain("if (!f || ev.pointerId !== id) return;");
    // measured from where the thumb was when filming started, never where it first touched
    expect(carousel).toContain("f.ax = f.x;");
    expect(carousel).toContain("hh?.onSlide?.(dx, dy, f.below);");
    // nothing scrolls or selects under it
    expect(carousel).toContain('window.addEventListener("touchmove", still, { capture: true, passive: false });');
    // the hold lives above the row, so a row that changes mid-clip never drops the finger
    expect(carousel).toContain("const h = useHold(onShoot ? hold : undefined, disabled || counting);");
    expect(studio).toContain("onSlide: zoomCaps ? (_dx, dy, below) => zoomTo(zoomFromSlide(slideFrom.current, dy, zoomCaps, below)) : undefined,");
    expect(studio).toContain("onLock: recorder.lock,");
    expect(read("src/components/community/clip-recorder.ts")).toContain("const lock = useCallback(() => {");
  });
  it("hands-free, a touch on the shutter stops it at once; a gesture the browser cancels keeps the clip (locked)", () => {
    const carousel = read("src/components/community/look-carousel.tsx");
    expect(carousel).toContain("if (h.recording) {");
    expect(carousel).toContain("h.onStop();");
    expect(carousel).toContain("if (cancelled && hh?.onLock) {");
    // the click a hold or a stop leaves behind never takes a photo
    expect(carousel).toContain("if (h.eatClick()) return;");
  });
  it("the camera takes every finger: a pinch zooms, never a look swipe or a flip", () => {
    expect(studio).toContain('phase === "shoot" ? "touch-none" : "touch-pan-y"');
    expect(studio).toContain("if (!st || pinched.current) return;");
  });
});

describe("the recording button: Instagram's surface, minimal while it films, nothing moves", () => {
  const carousel = read("src/components/community/look-carousel.tsx");
  const rec = read("src/components/community/clip-recorder.ts");
  it("grows into a translucent circle with a white rounded-square stop and a thin gradient ring filled by CSS", () => {
    expect(carousel).toContain("data-record-surface={state}");
    expect(carousel).toContain('className="absolute inset-0 rounded-full bg-white/20');
    expect(carousel).toContain("style={{ width: on ? 30 : 60, height: on ? 30 : 60, borderRadius: on ? 9 : 30, opacity: on ? 1 : 0 }}");
    expect(carousel).toContain('<animateTransform attributeName="gradientTransform" type="rotate"');
    expect(read("src/styles.css")).toContain("@keyframes jf-rec-ring { from { stroke-dashoffset: 377; } to { stroke-dashoffset: 0; } }");
    // the ring and the clock read when it started: the recorder never re-renders the camera every frame
    expect(rec).not.toContain("setElapsed");
    expect(rec).toContain("startedAt,");
  });
  it("haptics where the phone has them, never a sound while it films (the mic would hear it)", () => {
    expect(carousel).toContain('feedback("press");');
    expect(carousel).toContain('feedback("detent");');
    expect(studio).toContain('if (zoomDetent(prev, next, caps)) feedback("detent");');
    expect(carousel).not.toContain('feedback("toggle")');
  });
  it("while it films: the clock up top, the close, flash and library step away keeping their places, the zoom just over the button", () => {
    expect(studio).toContain("<RecordingClock startedAt={recorder.startedAt} locked={recorder.locked} />");
    expect(studio).toContain('recorder.recording && "pointer-events-none opacity-0"');
    expect(studio).toContain('recorder.recording && "pointer-events-none invisible opacity-0"');
    expect(studio).toContain('{recordable && hints.data && !hints.data.includes("hold_to_film") && (');
    expect(carousel).toContain('active && "pointer-events-none invisible opacity-0"');
    expect(studio).toContain("zoom={zoomCaps && recorder.recording ? <ZoomPill");
  });
  it("the app going to the background mid-clip ends it there, kept", () => {
    expect(studio).toContain('if (document.visibilityState === "hidden") recorder.stop();');
  });
});

