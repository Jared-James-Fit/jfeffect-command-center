import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FEED_COPY_MAX_SHARE,
  feedCopyPath,
  feedCopyPlan,
  feedCopyWorthIt,
} from "@/lib/set-videos/feed-copy";
import { filmFile, filmPaths, filmUpToDate, pickFilmClips } from "@/lib/workout-film";
import type { SourceInfo } from "@/lib/video-edit/plan";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const MiB = 1024 * 1024;

const src = (over: Partial<SourceInfo> = {}): SourceInfo => ({
  duration: 30,
  bytes: 50 * MiB,
  width: 2160,
  height: 3840,
  codec: "hvc1",
  audioCodec: "mp4a",
  hasAudio: true,
  fps: 30,
  container: "mov",
  ...over,
});

describe("a set video's 720p copy for Crew", () => {
  it("an iPhone's 4K original the coach got as it was gets a 720p copy sized for a workout post, never falling back to the original", () => {
    const plan = feedCopyPlan("original", src(), null, true);
    expect(plan?.mode).toBe("transcode");
    expect(Math.max(plan!.width, plan!.height)).toBe(1280);
    expect(plan!.copyFallback).toBeNull();
    // a clip the phone cut (a copy) the same, from the same selection
    const cut = feedCopyPlan("copy", src({ duration: 120, bytes: 200 * MiB }), { start: 10, end: 40 }, true);
    expect(cut?.start).toBe(10);
    expect(cut?.end).toBe(40);
    // ~10 MB for 30 s, against ~50 MB sent
    expect(plan!.estBytes).toBeLessThan(12 * MiB);
  });

  it("none when the coach's clip is already 720p, already lean, too long for a workout post, or the phone can't encode", () => {
    expect(feedCopyPlan("transcode", src(), null, true)).toBeNull();
    expect(
      feedCopyPlan("original", src({ width: 720, height: 1280, bytes: 8 * MiB }), null, true),
    ).toBeNull();
    expect(feedCopyPlan("original", src({ bytes: 3 * MiB }), null, true)).toBeNull();
    expect(feedCopyPlan("original", src({ duration: 140, bytes: 200 * MiB }), null, true)).toBeNull();
    expect(feedCopyPlan("original", src(), null, false)).toBeNull();
  });

  it("goes up only when it's clearly smaller than what was sent", () => {
    expect(FEED_COPY_MAX_SHARE).toBe(0.75);
    expect(feedCopyWorthIt(10 * MiB, 50 * MiB)).toBe(true);
    expect(feedCopyWorthIt(40 * MiB, 50 * MiB)).toBe(false);
    expect(feedCopyWorthIt(0, 50 * MiB)).toBe(false);
  });

  it("sits next to the original in the coach chat's folder, named so the database knows it", () => {
    expect(feedCopyPath("c1", "job-1", "mp4")).toBe("c1/set-videos/job-1-feed.mp4");
    const sql = read("supabase/migrations/20270309090000_set_video_feed_copy.sql");
    expect(sql).toContain("/set-videos/[A-Za-z0-9_-]+-feed\\.(mp4|mov|webm)$");
    // checked as a workout post's video, by the person who sent the set video
    expect(sql).toContain("PERFORM public.media_video_allowed('message-attachments', _path, 90, 52428800);");
    expect(sql).toContain("v.uploaded_by <> v_uid");
    expect(sql).toContain("c.owner IS DISTINCT FROM v_uid");
  });
});

describe("the film is made from the copy", () => {
  const original = {
    storage_path: "c1/set-videos/j1.mov",
    width: 2160,
    height: 3840,
    duration_s: "30.2",
    size_bytes: 52 * MiB,
  };
  const withCopy = {
    ...original,
    feed_path: "c1/set-videos/j1-feed.mp4",
    feed_width: 720,
    feed_height: 1280,
    feed_duration_s: 30.1,
    feed_size_bytes: 10 * MiB,
  };

  it("the copy's file, size and shape when there is one, else the original's", () => {
    expect(filmFile(original)).toEqual({
      path: "c1/set-videos/j1.mov",
      width: 2160,
      height: 3840,
      duration_s: 30.2,
      size_bytes: 52 * MiB,
      feed: false,
    });
    expect(filmFile(withCopy)).toEqual({
      path: "c1/set-videos/j1-feed.mp4",
      width: 720,
      height: 1280,
      duration_s: 30.1,
      size_bytes: 10 * MiB,
      feed: true,
    });
  });

  it("a 4K clip over a workout post's 50 MB now makes the film through its copy", () => {
    const clip = (v: typeof original & Partial<typeof withCopy>) => {
      const f = filmFile(v);
      return { id: "v", order: 1, set_index: 1, created_at: "2026-11-12T10:00:00Z", duration_s: f.duration_s, size_bytes: f.size_bytes };
    };
    expect(pickFilmClips([clip(original)]).picked).toHaveLength(0);
    expect(pickFilmClips([clip(withCopy)]).picked).toHaveLength(1);
  });

  it("a copy that lands after the film is up gets its own film path, so the post is behind and swaps it in", () => {
    const before = filmPaths("u1", "c1", "v1", original.storage_path);
    const after = filmPaths("u1", "c1", "v1", withCopy.feed_path);
    expect(after).toEqual({ path: "u1/film/c1/v1-feed.mp4", thumb: "u1/film/c1/v1-feed-poster.jpg" });
    expect(filmUpToDate([{ path: before.path }], [after.path])).toBe(false);
  });

  it("the server, the app and the uploader are wired to it", () => {
    const fn = read("src/lib/workout-film.functions.ts");
    expect(fn).toContain("const f = filmFile(v);");
    expect(fn).toContain("if (!(await copyInto(admin, v.src, path))) continue;");
    // the film files the post no longer shows are removed
    expect(fn).toContain("const ours = `${userId}/film/${comp.id}/`;");
    expect(read("src/lib/workout-film-client.ts")).toContain(
      "picked.map((v) => filmPaths(userId, completionId, v.id, v.src).path)",
    );
    expect(read("src/components/workout-day/set-video-cell.tsx")).toContain(
      "feed_path, feed_width, feed_height, feed_duration_s, feed_size_bytes",
    );
    const up = read("src/lib/set-videos/uploader.ts");
    expect(up).toContain(
      "const feedPlan = feedCopyPlan(out.mode, picked.info, picked.trim, picked.canEncode);",
    );
    // the coach's clips always go first; a copy starts only while nothing else is sending
    expect(up).toContain("if (feedRunning || !sendingIdle()) return;");
    expect(up).toContain("await waitForIdleSending(signal);");
    // only while their film goes to Crew
    expect(up).toContain("if (!(await filmGoesToCrew())) return;");
    expect(up).toContain('context: "workout",');
    expect(up).toContain('db.rpc("set_video_feed_copy", { _id: item.setVideoId, _path: path })');
  });
});
