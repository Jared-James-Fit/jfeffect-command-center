import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEED_PAGE_SIZE, FIRST_FEED_PAGE, GRID_FIRST_PAGE, GRID_PAGE_SIZE } from "@/lib/community";
import { GRID_PREFETCH_PX } from "@/components/community/post-grid";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const grid = read("src/components/community/post-grid.tsx");

describe("a profile's grid, Instagram's way", () => {
  it("three across, edge to edge on a phone, portrait 3:4 tiles with a hairline between", () => {
    expect(grid).toContain('cn("grid grid-cols-3 gap-[2px]", edge && "-mx-3 sm:mx-0 sm:overflow-hidden sm:rounded-xl")');
    expect(grid).toContain('className="relative aspect-[3/4] w-full overflow-hidden bg-muted active:opacity-90"');
    // a photo fills its tile from the middle and fades in
    expect(read("src/components/community/post-tile.tsx")).toContain('className="media-fade h-full w-full object-cover object-center"');
  });

  it("pages are whole rows of three, and the next one starts loading well before the end", () => {
    expect(GRID_FIRST_PAGE % 3).toBe(0);
    expect(GRID_PAGE_SIZE % 3).toBe(0);
    expect(GRID_FIRST_PAGE).toBeGreaterThanOrEqual(12); // fills the first screen under the profile
    expect(GRID_PREFETCH_PX).toBeGreaterThanOrEqual(800);
    // the feed keeps its own small pages; a profile's grid (author set) gets the grid's
    expect(FIRST_FEED_PAGE).toBe(5);
    expect(FEED_PAGE_SIZE).toBe(10);
    expect(read("src/lib/community.queries.ts")).toContain("_limit: authorUserId ? (pageParam ? GRID_PAGE_SIZE : GRID_FIRST_PAGE) : pageParam ? FEED_PAGE_SIZE : FIRST_FEED_PAGE,");
    const saves = read("src/lib/community-saves.ts");
    expect(saves.match(/_limit: pageParam \? GRID_PAGE_SIZE : GRID_FIRST_PAGE,/g)?.length).toBe(2);
  });

  it("loads by itself as you scroll, spins only while a page is on its way, and simply ends", () => {
    expect(grid).toContain("if (!near.on || !hasNextPage || isFetchingNextPage || isFetchNextPageError) return;");
    // never a page ahead of what the observer last saw: where the end really is decides
    expect(grid).toContain("if (near.el && near.el.getBoundingClientRect().top > window.innerHeight + GRID_PREFETCH_PX) return;");
    expect(grid).toContain("if (!hasNextPage) return null;");
    expect(grid).toContain("<ActivitySpinner size={26} />");
    expect(grid).toContain("Couldn't load more. Tap to try again");
    // no Show more buttons left on any grid
    for (const f of ["profile-view", "saved-view"]) expect(read(`src/components/community/${f}.tsx`)).not.toContain('"Show more"');
    expect(read("src/components/community/profile-view.tsx")).toContain("pager={showArchived || blocked ? undefined : feed}");
    expect(read("src/components/community/saved-view.tsx")).toContain('<PostGrid posts={posts} urls={urls} unit={unit} onTap={onOpenPost} mark="repost" pager={q} />');
  });

  it("a card without a picture (a coach post, a workout, a lock in) sits centred in its tile, its mark (PR, Poll, Live) alone in the corner", () => {
    const tile = read("src/components/community/post-tile.tsx");
    // the same room above and below, both ways centred, so every tile lines up with the ones beside it
    expect(tile).toContain('"relative flex h-full w-full flex-col items-center justify-center gap-1 px-2.5 py-6 text-center"');
    expect(tile).toContain('{mark && <span className="absolute left-2 top-2 flex">{mark}</span>}');
    // no "Note" / "Workout" label on the grid: only what the card is (PR, a poll, training now)
    expect(tile).toContain("mark={post.poll ? <TileMark>Poll</TileMark> : null}");
    expect(tile).toContain('mark={pr ? <TileMark tone="gold">PR</TileMark> : null}');
    expect(tile).toContain("mark={isTrainingNow(post) ? <LiveDot");
    // a lesson shows its own title, not the caption's first words
    expect(tile).toContain("{lessonTitle(post) ? (");
    // Home's Crew cards (large) keep their own layout
    expect(tile).toContain(') : post.kind === "note" && !large ? (');
  });
});
