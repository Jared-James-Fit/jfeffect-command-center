import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { holdPlaybackSession, installMediaPlaybackSession, playbackHolds, setBaseAudioSessionType } from "@/lib/audio-session";
import { demoEmbedUrl } from "@/lib/demo-video";
import { guideVideoUrl, hasNoOwnVideo } from "@/lib/exercise-guide";

const read = (p: string) => readFileSync(p, "utf8");

function withSession(type = "auto") {
  const session = { type };
  vi.stubGlobal("navigator", { audioSession: session });
  return session;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("demo videos keep their sound (iOS audio session)", () => {
  it("UI sounds sit on ambient; a demo on screen holds playback and puts ambient back after", () => {
    const s = withSession();
    setBaseAudioSessionType("ambient");
    expect(s.type).toBe("ambient");
    const release = holdPlaybackSession();
    expect(s.type).toBe("playback");
    release();
    release(); // twice is harmless
    expect(s.type).toBe("ambient");
    expect(playbackHolds()).toBe(0);
  });

  it("two players at once: playback until the last one closes", () => {
    const s = withSession("ambient");
    const a = holdPlaybackSession();
    const b = holdPlaybackSession();
    a();
    expect(s.type).toBe("playback");
    b();
    expect(s.type).toBe("ambient");
  });

  it("app sounds starting up mid-video don't silence it: ambient waits for the video to close", () => {
    const s = withSession("auto");
    const release = holdPlaybackSession();
    setBaseAudioSessionType("ambient");
    expect(s.type).toBe("playback");
    release();
    expect(s.type).toBe("ambient");
  });

  it("native videos: playing with sound holds playback, pausing (even after it's removed) lets go; muted autoplays don't count", () => {
    const s = withSession("ambient");
    // a page that hands its capture listeners the event (no DOM in this runner)
    const listeners = new Map<string, (e: Event) => void>();
    const page = { addEventListener: (type: string, fn: (e: Event) => void) => listeners.set(type, fn) } as unknown as Document;
    installMediaPlaybackSession(page);
    const v = Object.assign(new EventTarget(), { paused: false, muted: true, ended: false, volume: 1 });
    const fire = (type: string) => listeners.get(type)?.({ type, target: v } as unknown as Event);
    fire("play");
    expect(s.type).toBe("ambient"); // muted autoplay
    v.muted = false;
    fire("volumechange");
    expect(s.type).toBe("playback");
    // removed mid-play: the pause only reaches the element itself
    v.paused = true;
    v.dispatchEvent(new Event("pause"));
    expect(s.type).toBe("ambient");
  });

  it("app sounds go through the base setter and switch on the media watcher", () => {
    const src = read("src/lib/app-sounds.ts");
    expect(src).toContain('setBaseAudioSessionType("ambient")');
    expect(src).not.toMatch(/session\.type = "ambient"/);
    expect(src).toContain("installMediaPlaybackSession();");
  });
});

describe("demo player URLs", () => {
  it("never autoplays (iOS autoplays embeds muted) and plays inline", () => {
    const u = new URL(demoEmbedUrl("https://player.vimeo.com/video/1198574587?badge=0&autopause=0&player_id=0&app_id=532813&autoplay=1&muted=1"));
    expect(u.searchParams.get("autoplay")).toBeNull();
    expect(u.searchParams.get("muted")).toBeNull();
    expect(u.searchParams.get("playsinline")).toBe("1");
    expect(u.searchParams.get("app_id")).toBe("532813");
  });
  it("plain Vimeo and YouTube links become players", () => {
    expect(demoEmbedUrl("https://vimeo.com/1198574587")).toMatch(/^https:\/\/player\.vimeo\.com\/video\/1198574587\?/);
    expect(demoEmbedUrl("https://youtu.be/_6R8rnTBJNU")).toBe("https://www.youtube-nocookie.com/embed/_6R8rnTBJNU?playsinline=1&rel=0&modestbranding=1");
    expect(demoEmbedUrl("https://www.youtube.com/watch?v=_6R8rnTBJNU&t=3")).toContain("/embed/_6R8rnTBJNU?");
    expect(demoEmbedUrl("not a url")).toBe("not a url");
  });
});

describe("the How To guide", () => {
  const vimeo = "https://player.vimeo.com/video/1?title=0";
  it("plays the published Vimeo, else any link on the row; blank strings are no video", () => {
    expect(guideVideoUrl({ video_provider: "vimeo", vimeo_embed_url: vimeo, video_migration_status: "published_with_vimeo" })).toBe(vimeo);
    expect(guideVideoUrl({ video_url: vimeo })).toBe(vimeo);
    expect(guideVideoUrl({ youtube_url: "" })).toBeNull();
    expect(hasNoOwnVideo({ youtube_url: "", video_url: null })).toBe(true);
    expect(hasNoOwnVideo({ vimeo_embed_url: vimeo })).toBe(false);
  });

  it("sheet: one shared player, the borrowed demo is labelled, the touch-down warms everything", () => {
    const sheet = read("src/components/workout-day/deferred-exercise-how-to-sheet.tsx");
    expect(sheet).toContain("<ExerciseDemoVideo url={videoUrl}");
    expect(sheet).toContain("data-borrowed-demo");
    expect(sheet).not.toContain("<iframe");
    const actions = read("src/components/workout-day/deferred-exercise-actions.tsx");
    expect(actions).toContain("warmDemoPlayer();");
    expect(actions).toContain("queryKey: exerciseGuideKey(exerciseId, fallbackName)");
    expect(actions).toContain("onPointerDown={warm}");
  });

  it("every demo player is the shared one (no muted autoplay left in Quick Swap)", () => {
    const swap = read("src/components/workout-day/QuickSwapButton.tsx");
    expect(swap).toContain("<ExerciseDemoVideo url={demoUrl as string}");
    expect(swap).not.toContain("autoplay=1");
    expect(read("src/routes/_authenticated/portal/exercises.tsx")).toContain("<ExerciseDemoVideo");
    expect(read("src/components/exercises/library/exercise-library-control-center.tsx")).toContain("<ExerciseDemoVideo");
  });

  it("the player holds playback audio, offers a retry when slow and says when offline", () => {
    const player = read("src/components/exercise-demo-video.tsx");
    expect(player).toContain("usePlaybackSession(true);");
    expect(player).toContain("Try again");
    expect(player).toContain("You're offline");
  });
});
