import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FILTER_GROUPS, STORY_FILTERS, filterRow, groupOrder, templateWords, type FilterContext } from "@/lib/story-filters";
import { buildFilterRow, NORMAL_KEY } from "@/components/community/crew-filters";
import { storyLookLine } from "@/lib/story-looks";

/**
 * Story templates and colour filters, kept apart (Nov 23 2026): the gym's
 * collections, Favorites, the person's own words, and the quiet attribution
 * line a story carries as metadata.
 */
const read = (p: string) => readFileSync(p, "utf8");
const ctx: FilterContext = { now: new Date(2026, 10, 23, 18, 0), firstName: "Jared", session: null, finished: null, block: null, fuel: null };

describe("the gym's collections", () => {
  const ids = (g: string) => STORY_FILTERS.filter((f) => f.group === g).map((f) => (typeof f.label === "string" ? f.label : f.id));
  it("are all there, named as asked", () => {
    expect(ids("meet")).toEqual(
      expect.arrayContaining(["Game Day", "Platform Ready", "Weighed In", "Attempt Season", "3rd Attempt Demon", "White Light Hunter", "9/9 Club", "Meet Day Aura", "Total Secured", "Bomb Out Risk", "Please Don't Bomb", "Road to a Bomb Out", "2/9 But Confident", "Judges Hate Me", "Command Violation", "Misgroove But Send It", "Deadlift to Save the Total", "One Pull to Glory", "Mission Complete"]),
    );
    expect(ids("rest")).toHaveLength(10);
    expect(ids("gymbro")).toHaveLength(10);
    expect(ids("memes")).toEqual(expect.arrayContaining(["Aura +1000", "Gym NPC", "CNS Left The Chat", "Rest Timer 47:32", "Patch Notes Live", "Brain Off Bar On"]));
    expect(ids("stims")).toHaveLength(14);
  });
  it("every one of them has words that can be changed", () => {
    for (const f of STORY_FILTERS.filter((x) => ["meet", "rest", "gymbro", "memes", "stims"].includes(x.group))) expect(f.edit?.title, f.id).toBeTruthy();
  });
  it("the person's words replace the template's own, and a change repaints it (the design's cache key)", () => {
    const f = STORY_FILTERS.find((x) => x.id === "gameday")!;
    expect(templateWords(f, ctx).title).toBe("Game day");
    expect(templateWords(f, { ...ctx, custom: { gameday: { title: "Nationals", sub: "Feb 8" } } })).toEqual({ title: "Nationals", sub: "Feb 8" });
    expect(read("src/lib/story-filters.ts")).toContain("c.custom ?? null, c.now.getFullYear()");
  });
  it("colour grades are no longer a template group (colour is the editor's Filters, combined with a template)", () => {
    expect(FILTER_GROUPS.map((g) => g.key)).not.toContain("vibe");
    expect(filterRow(ctx).some((f) => f.group === "vibe")).toBe(false);
    expect(groupOrder(ctx)).not.toContain("vibe");
  });
});

describe("Favorites", () => {
  it("lead the row in the order starred, once each, with their own chip", () => {
    const plain = buildFilterRow(ctx);
    expect(plain.groups.map((g) => g.key)).not.toContain("fav");
    const row = buildFilterRow(ctx, {}, { favorites: ["fx:judgeshate", "fx:gameday", "fx:nope"] });
    expect(row.items[0].key).toBe(NORMAL_KEY);
    expect(row.items.slice(1, 3).map((i) => i.key)).toEqual(["fx:judgeshate", "fx:gameday"]);
    expect(row.items.filter((i) => i.key === "fx:gameday")).toHaveLength(1);
    expect(row.groups[0].key).toBe("fav");
  });
  it("are starred from the template's chip over the shutter, with no popup", () => {
    const picker = read("src/components/community/share-workout-picker.tsx");
    expect(picker).toContain("onFavorite={() => void favs.toggle(fx!)}");
    expect(picker).toContain("<TemplateTextSheet");
  });
});

describe("attribution", () => {
  it("says the template and the colour filter, never Original or Normal, never a name twice", () => {
    expect(storyLookLine({ templateLabel: "Game Day", colourLabel: "Cinematic" })).toBe("Game Day · Cinematic");
    expect(storyLookLine({ templateLabel: null, colourLabel: "Cool" })).toBe("Cool");
    expect(storyLookLine({ templateLabel: "Normal", colourLabel: "Original" })).toBeNull();
    expect(storyLookLine({ templateLabel: "Film", colourLabel: "Film" })).toBe("Film");
  });
  it("rides on the story as metadata (never burnt into the picture), only when the poster leaves it on", () => {
    const studio = read("src/components/community/share-studio.tsx");
    expect(studio).toContain("if (storyLook && showLook) void saveStoryLook(id, storyLook);");
    expect(studio).toContain("data-story-look-toggle");
    const sql = read("supabase/migrations/20270518090000_story_looks.sql");
    // the author's own story only, read back only for stories the caller can see, the table closed to clients
    expect(sql).toContain("AND p.author_user_id = public.community_main_account(uid)");
    expect(sql).toContain("AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)");
    expect(sql).toContain("REVOKE ALL ON public.community_story_looks FROM PUBLIC, anon, authenticated;");
  });
  it("shows as one quiet line under the poster's name", () => {
    const viewer = read("src/components/community/crew-stories.tsx");
    expect(viewer).toContain("const line = storyLookLine(looks.get(post.id));");
    expect(viewer).toContain("data-story-look");
  });
});

describe("the colour panel", () => {
  const panel = read("src/components/community/filter-panel.tsx");
  it("is three tabs at one height (switching never moves the picture), folds to its tabs, compares, undoes", () => {
    expect(panel).toContain("const BODY_H = 124;");
    expect(panel).toContain("style={{ height: BODY_H }}");
    for (const k of ["data-filter-fold", "data-filter-compare", "data-filter-undo", "data-filter-redo", "data-filter-save-preset"]) expect(panel).toContain(k);
  });
  it("draft restores are quiet: no popup when a caption or photo comes back", () => {
    expect(read("src/components/community/share-studio.tsx")).not.toContain("Picked up where you left off");
    expect(read("src/components/community/post-composer.tsx")).not.toContain("Your caption is back");
    expect(read("src/components/community/share-studio.tsx")).not.toContain("Two fingers to move or zoom the photo");
  });
});

describe("picking media", () => {
  it("the phone's own picker, by kind (a web page can't read albums; the picker has them)", () => {
    const pick = read("src/components/community/composer-pick.tsx");
    expect(pick).toContain('accept="image/*" multiple hidden');
    expect(pick).toContain('accept="video/*" multiple hidden');
    expect(read("src/components/community/post-composer.tsx")).toContain('data-composer-pick={k}');
  });
});
