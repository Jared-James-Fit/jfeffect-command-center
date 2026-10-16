import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STICKER_Y_MAX, STICKER_Y_MIN, STORY_SAFE_TOP, cleanSticker, stickerSpot, stickerUpTop, stickerY, storyFrameLayout, storyRows, type LessonPlanRow } from "@/lib/lessons";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("a story sticker can be moved, and stays where it was put", () => {
  it("keeps its spot inside the band between the name and the reply bar, to 2 places", () => {
    expect(stickerY(0.3)).toBe(0.3);
    expect(stickerY(0.333333)).toBe(0.33);
    expect(stickerY(0.01)).toBe(STICKER_Y_MIN);
    expect(stickerY(0.99)).toBe(STICKER_Y_MAX);
    // anything else is "the usual spot"
    expect(stickerY(undefined)).toBeUndefined();
    expect(stickerY("0.3")).toBeUndefined();
    expect(stickerY(Number.NaN)).toBeUndefined();
  });

  it("is saved with the sticker, and a sticker without one is the same as before", () => {
    expect(cleanSticker({ type: "question", q: "one cue?", y: 0.3 })).toEqual({ ok: true, sticker: { type: "question", q: "one cue?", y: 0.3 } });
    expect(cleanSticker({ type: "slider", q: "how cooked?", emoji: "", y: 0.9 })).toEqual({ ok: true, sticker: { type: "slider", q: "how cooked?", emoji: "🔥", y: STICKER_Y_MAX } });
    expect(cleanSticker({ type: "question", q: "one cue?" })).toEqual({ ok: true, sticker: { type: "question", q: "one cue?" } });
  });

  it("sits where it was put on the story, else just above the reply bar", () => {
    expect(stickerSpot(0.3, 150)).toEqual({ top: "30%", transform: "translateY(-50%)" });
    expect(stickerSpot(undefined, 150)).toEqual({ bottom: "122px" });
    expect(stickerSpot(undefined, null)).toEqual({ bottom: "calc(env(safe-area-inset-bottom) + 132px)" });
  });

  it("moved into the top half, the lesson's words go under it", () => {
    expect(stickerUpTop(0.3)).toBe(true);
    expect(stickerUpTop(0.6)).toBe(false);
    expect(stickerUpTop(undefined)).toBe(false);
    expect(storyFrameLayout({ y: 0.3 }).place).toBe("bottom");
    expect(storyFrameLayout({ y: 0.6 }).place).toBe("top");
    expect(storyFrameLayout({}).place).toBe("top");
    expect(storyFrameLayout(null).place).toBe("center");
    expect(read("src/components/community/lesson-card.tsx")).toContain("const layout = storyFrameLayout(post.sticker);");
  });

  it("the database keeps it to the same band, and every save path goes through that cleaner", () => {
    const sql = read("supabase/migrations/20261201090000_story_sticker_position.sql");
    expect(sql).toContain("round(least(greatest((_s->>'y')::numeric, 0.20), 0.66), 2)");
    expect(sql).toContain("RETURN jsonb_build_object('type', 'question', 'q', v_q) || v_at;");
    expect(STICKER_Y_MIN).toBe(0.2);
    expect(STICKER_Y_MAX).toBe(0.66);
  });

  it("rewording a sticker keeps its spot, on a lesson and on your own post", () => {
    const editor = read("src/components/community/sticker-editor.tsx");
    expect(editor).toContain("cleanSticker({ ...build(), ...(initial?.y !== undefined ? { y: initial.y } : {}) })");
    expect(editor).toContain("const at = post.sticker?.y !== undefined ? { y: post.sticker.y } : {};");
    expect(read("src/components/community/crew-stories.tsx")).toContain("style={stickerSpot(post.sticker.y, barH)}");
  });
});

describe("the coach previews the coming lessons as stories and arranges them", () => {
  const row = (day: string, extra: Partial<LessonPlanRow> = {}) =>
    ({ id: day, day, status: "planned", posted_as: null, item: { id: "i" }, ...extra }) as unknown as LessonPlanRow;

  it("steps through every lesson from today on that will be a story", () => {
    const plan = [
      row("2026-10-14", { status: "posted", posted_as: "lesson" }),
      row("2026-10-15", { status: "posted", posted_as: "lesson" }),
      row("2026-10-16"),
      row("2026-10-17", { status: "skipped" }),
      row("2026-10-19", { item: null }),
      row("2026-10-20", { status: "posted", posted_as: "data" }),
      row("2026-10-21", { status: "approved" }),
    ];
    expect(storyRows(plan, "2026-10-15").map((r) => r.day)).toEqual(["2026-10-15", "2026-10-16", "2026-10-21"]);
  });

  it("opens from the sheet's story, a ring on each day, or Preview the stories", () => {
    const ui = read("src/components/community/coach-lessons.tsx");
    expect(ui).toContain("<StoryThumb row={row} data={data} onOpen={onPlay} />");
    expect(ui).toContain("data-lesson-row-play");
    expect(ui).toContain("data-lesson-play-all");
    expect(ui).toContain("<LessonStoryPlayer rows={stories} startId={playId} data={data} onClose={() => setPlayId(null)} />");
  });

  it("taps through like a story, drags the sticker (saved on letting go), and approves then moves on", () => {
    const player = read("src/components/community/lesson-story-player.tsx");
    expect(player).toContain("if (e.clientX - r.left < r.width / 3) onPrev?.();");
    expect(player).toContain("if (d?.moved && live !== null) onPlace?.(live);");
    expect(player).toContain('{ kind: "save", id: rowId, sticker: { ...row.sticker, y }, stickerSet: true }');
    expect(player).toContain('run({ kind: "approve", id: row.id }, `Approved for ${whenLabel(row)}`, () => go(1))');
    // a story that's already up isn't moved from here
    expect(player).toContain("onPlace={posted ? undefined : place}");
  });
});

describe("a story's words never sit under the name row or the reply bar", () => {
  it("start below the header on every phone (its safe area + the 53px row + air) and end above the bar", () => {
    for (const l of [storyFrameLayout(null), storyFrameLayout({ y: 0.6 }), storyFrameLayout({ y: 0.3 })]) {
      expect(l.style.paddingTop).toBe(STORY_SAFE_TOP);
      expect(String(l.style.paddingBottom)).toContain("var(--story-safe-bottom");
    }
    expect(STORY_SAFE_TOP).toBe("calc(var(--story-safe-top, 0.6rem) + 72px)");
  });

  it("the viewer feeds in the phone's safe areas, and the coach's preview an iPhone's, so both lay out the same", () => {
    const stories = read("src/components/community/crew-stories.tsx");
    expect(stories).toContain("style={STORY_DEVICE_INSETS}");
    expect(stories.match(/style=\{\{ paddingTop: "var\(--story-safe-top\)" \}\}/g)?.length).toBe(2);
    // every frame with words uses the same rule: lesson, a workout win, a words post
    expect(read("src/components/community/lesson-card.tsx")).toContain("style={layout.style}");
    expect(stories).toContain('style={layout.style} data-story-frame="win"');
    expect(stories).toContain('style={layout.style} data-story-frame="words"');
    const preview = read("src/components/community/lesson-story-player.tsx");
    expect(preview).toContain("...STORY_PREVIEW_INSETS");
    expect(preview).toContain('style={{ paddingTop: "var(--story-safe-top)" }}');
    expect(preview).toContain('style={{ paddingBottom: "var(--story-safe-bottom)" }}');
  });
});
