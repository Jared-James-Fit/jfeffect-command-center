import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { crewStories, storyWorthy, STORY_WINDOW_MS } from "@/lib/community";
import { holdsMapOrSet, shouldPersistQuery } from "@/lib/query-persister";
import { draftWorthKeeping } from "@/lib/post-draft";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("the on-phone query cache never stores what JSON can't bring back", () => {
  it("a Map (the Hall of Strength's meet tiers) stays in memory; plain data still goes to disk", () => {
    const q = (data: unknown) => ({ queryKey: ["strength-board", "tiers"], state: { status: "success", data } });
    expect(holdsMapOrSet(new Map([["a", 1]]))).toBe(true);
    expect(holdsMapOrSet({ rows: [{ seen: new Set(["x"]) }] })).toBe(true);
    expect(shouldPersistQuery(q(new Map([["a", { top_level: "national" }]])))).toBe(false);
    expect(shouldPersistQuery(q([{ athlete_id: "a", top_level: "national" }]))).toBe(true);
    expect(read("src/lib/query-persister.ts")).toContain('export const QUERY_PERSIST_BUSTER = "v9";');
  });
});

describe("posting never strands people", () => {
  it("the studio is fetched early, fails full screen, and a crash in it is contained and reported", () => {
    const shell = read("src/components/community/studio-chunks.tsx");
    expect(shell).toContain("usePreloadStudio");
    expect(shell).toContain("requestIdleCallback");
    expect(shell).toContain('_route: `${window.location.pathname}#posting`');
    expect(shell).toContain("Couldn't open the camera");
    for (const f of ["share-workout-picker.tsx", "lock-in.tsx", "workout-share-studio.tsx"]) {
      expect(read(`src/components/community/${f}`)).toContain("StudioShell");
      expect(read(`src/components/community/${f}`)).not.toContain('import("@/components/community/share-studio")');
    }
    expect(read("src/components/workout-submission-summary.tsx")).toContain("WorkoutShareStudio.preload()");
  });
  it("a draft is kept while there's a photo or words, and the studio restores and clears it", () => {
    expect(draftWorthKeeping({ caption: "", photo: null })).toBe(false);
    expect(draftWorthKeeping({ caption: "  ", photo: null })).toBe(false);
    expect(draftWorthKeeping({ caption: "heavy day", photo: null })).toBe(true);
    expect(draftWorthKeeping({ caption: "", photo: new Blob(["x"]) })).toBe(true);
    const studio = read("src/components/community/share-studio.tsx");
    expect(studio).toContain("loadDraft(key)");
    expect(studio).toContain("void clearDraft();");
    expect(studio).toContain('"Picked up where you left off"');
  });
  it("big canvases give their memory back (iPhone's canvas cap)", () => {
    const studio = read("src/components/community/share-studio.tsx");
    expect(studio.match(/releaseCanvas\(/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(read("src/lib/image-compress.ts")).toContain("canvas.width = 0;");
  });
});

describe("members post anything, not only workouts", () => {
  it("the + opens on a Post mode next to Lock in / Workout, with Write for words", () => {
    const btn = read("src/components/community/share-workout-picker.tsx");
    expect(btn).toContain('{ key: "post", label: "Post" }');
    expect(btn).toContain("createCommunityPost(qc,");
    expect(btn).toContain('const fallbackMode: Mode = today ? "lockin" : freshWorkout ? "workout" : "post";');
    expect(btn).toContain('saveLabel="Post"');
    expect(read("src/lib/community.queries.ts")).toContain('db.rpc("community_create_post"');
  });
  it("the database function: own media only, no points, a daily cap", () => {
    const sql = read("supabase/migrations/20261101100000_community_member_posts.sql");
    expect(sql).toContain("public.community_clean_media(_media, uid)");
    expect(sql).toContain("'note'");
    expect(sql).toContain(">= 25");
  });
});

describe("Crew Stories", () => {
  const now = Date.UTC(2026, 9, 13, 18);
  const at = (h: number) => new Date(now - h * 3600e3).toISOString();
  const author = (id: string) => ({ user_id: id, name: id[0].toUpperCase() + id.slice(1), avatar_url: null, is_coach: false });
  const stats = (o: object) => ({ prs: [], pr_count: 0, month_sessions: 2, week_sessions: 1, top_lift: { exercise_name: "Squat", reps: 5, load_kg: 100 }, working_sets: 12, duration_min: 50, ...o });
  const pulse = (id: string, who: string, h: number, o: object, seen = false) => ({ id, author: author(who), created_at: at(h), auto: true, stats: stats(o), visibility: "community", is_mine: false, seen }) as any;
  const post = (id: string, who: string, h: number, seen = false, extra: object = {}) => ({ id, author: author(who), created_at: at(h), auto: false, stats: null, visibility: "community", is_mine: false, seen, ...extra }) as any;

  it("only real moments from the automatic posts: a PR, a milestone, a streak; never a routine session", () => {
    expect(storyWorthy(pulse("a", "vicky", 1, { prs: [{ exercise_name: "Squat", reps: 3, load_kg: 140, scope: "atpr" }], pr_count: 1 }))).toBe(true);
    expect(storyWorthy(pulse("b", "vicky", 1, { week_sessions: 3 }))).toBe(true);
    expect(storyWorthy(pulse("c", "vicky", 1, {}))).toBe(false); // a top set
    expect(storyWorthy(pulse("d", "vicky", 1, { top_lift: null }))).toBe(false); // session done
    expect(storyWorthy(post("e", "marc", 1))).toBe(true);
    expect(storyWorthy(post("f", "marc", 1, false, { visibility: "coach" }))).toBe(false);
  });
  it("one bubble a person, their last day in order, unseen first, never your own", () => {
    const g = crewStories([
      post("old", "marc", 30),
      post("m2", "marc", 2, true),
      post("m1", "marc", 5, true),
      pulse("v1", "vicky", 3, { week_sessions: 4 }),
      post("me", "jared", 1, false, { is_mine: true }),
      pulse("routine", "nicole", 1, {}),
    ], now);
    expect(g.map((x) => x.author.user_id)).toEqual(["vicky", "marc"]);
    expect(g[1].items.map((p) => p.id)).toEqual(["m1", "m2"]);
    expect(g[0].unseen).toBe(true);
    expect(g[1].unseen).toBe(false);
    expect(STORY_WINDOW_MS).toBe(24 * 3600e3);
  });
  it("sits at the top of the feed with your own + first; seen comes from the server", () => {
    const screen = read("src/components/community/community-screen.tsx");
    expect(screen).toContain("<StoryRail");
    expect(screen).toContain('variant="bubble"');
    expect(read("src/components/community/crew-stories.tsx")).toContain("markPostViewed(post.id)");
    expect(read("supabase/migrations/20261101110000_community_post_seen.sql")).toContain("'seen', EXISTS");
  });
});
