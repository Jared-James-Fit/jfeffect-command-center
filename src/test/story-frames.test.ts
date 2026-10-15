import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { storyFrameKind, storyWords } from "@/lib/community";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const stats = { prs: [{ exercise_name: "Hip Thrust - Barbell", reps: 8, load_kg: 102, scope: "atpr" }], pr_count: 1, month_sessions: 2, week_sessions: 1, top_lift: null, working_sets: 14, duration_min: 39 } as any;
const none = { series: null, stats: null, auto: false, media_type: null, gif_url: null } as const;

describe("every crew post plays as a story, never a blank one", () => {
  it("a workout shared without a photo leads with its win (Nicole's Hip Thrust PR, no photo, no caption)", () => {
    expect(storyFrameKind({ ...none, stats })).toBe("win");
    // posted by itself, as before
    expect(storyFrameKind({ ...none, stats, auto: true })).toBe("win");
    // with a photo or a GIF, the picture leads (its caption goes in the bar)
    expect(storyFrameKind({ ...none, stats, media_type: "image" })).toBe("media");
    expect(storyFrameKind({ ...none, stats, gif_url: "https://media.giphy.com/x.gif" })).toBe("media");
  });

  it("a lesson is a lesson, then pictures, then words", () => {
    expect(storyFrameKind({ ...none, series: "lesson", media_type: "image" })).toBe("lesson");
    expect(storyFrameKind({ ...none, media_type: "video" })).toBe("media");
    expect(storyFrameKind({ ...none, gif_url: "https://media.giphy.com/x.gif" })).toBe("media");
    // a reopened workout (no numbers) and no picture: words
    expect(storyFrameKind(none)).toBe("words");
  });

  it("a words story always has words: the caption, else what the post is", () => {
    const empty = { caption: null, quote: null, quote_author: null, shared_comment: null, session_title: null, locked_in_at: null, audio: null, poll: null };
    expect(storyWords({ ...empty, caption: "  leg day  " })).toEqual({ text: "leg day", by: null });
    expect(storyWords({ ...empty, caption: "   ", quote: "Discipline is choosing", quote_author: "Someone" })).toEqual({ text: "“Discipline is choosing”", by: "Someone" });
    expect(storyWords({ ...empty, shared_comment: { id: "c", post_id: "p", body: "great set", created_at: "", author: { name: "Dwayne" } as any, post_author: null, media: null } })).toEqual({ text: "great set", by: "Dwayne" });
    expect(storyWords({ ...empty, shared_comment: { gone: true }, session_title: "Lower A" })).toEqual({ text: "Lower A", by: null });
    expect(storyWords({ ...empty, locked_in_at: "2026-10-15T17:00:00Z" }).text).toBe("Locked in");
    expect(storyWords({ ...empty, audio: { path: "a.m4a", duration: 4 } }).text).toBe("A voice memo");
    expect(storyWords({ ...empty, poll: { options: [], total: 0, my_vote: null } }).text).toBe("A poll");
    expect(storyWords(empty).text).toBe("A new post");
  });

  it("the story viewer draws from those rules, and a workout card's caption sits in the bar", () => {
    const stories = read("src/components/community/crew-stories.tsx");
    expect(stories).toContain("const kind = storyFrameKind(post);");
    expect(stories).toContain("const words = storyWords(post);");
    expect(stories).not.toContain("{post.caption}</p>");
    expect(stories).toContain('const caption = frame === "media" || frame === "win" ? post.caption?.trim() : null;');
  });
});
