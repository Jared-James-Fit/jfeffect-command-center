import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { postSlides, type CommunityPost } from "@/lib/community";
import { isFilmSummary, type FilmSlide } from "@/lib/workout-film";

const read = (p: string) => readFileSync(p, "utf8");

/**
 * Nov 17 2026: on a post's screen a workout film's set ("Competition Squat /
 * Top set · 455 lb × 1 @ RPE 6") sat over the top-left of the clip. It's in
 * the words at the bottom now, the set of the slide on screen, with the
 * workout's name above it and View workout as a pill under it.
 */
describe("a film post's set is said in its words, the slide on screen's", () => {
  const film: FilmSlide[] = [
    {
      path: "u/film/c/a.mp4",
      exercise: "Competition Squat",
      set: 1,
      set_name: "Top set",
      main: true,
      kg: 206.4,
      label: "455 lb × 1 @ RPE 6",
      label_no_load: "1 rep @ RPE 6",
    },
    {
      path: "u/film/c/b.mp4",
      exercise: "Competition Squat",
      set: 4,
      set_name: "Backoff 3",
      main: true,
      kg: 170.1,
      label: "375 lb × 4 @ RPE 6",
      label_no_load: "4 reps @ RPE 6",
    },
    {
      path: "u/film/c/c.mp4",
      exercise: "Close-Grip Block Press",
      set: 1,
      set_name: "Top set",
      main: false,
      kg: 124.7,
      label: "275 lb × 6 @ RPE 6",
      label_no_load: "6 reps @ RPE 6",
    },
  ];
  // a photo they added first, then the clips (a mixed post)
  const post = {
    media_path: "u/photo.jpg",
    media_thumb_path: null,
    media_type: "image",
    media_width: 1080,
    media_height: 1350,
    extra_media: film.map((f) => ({
      path: f.path,
      thumb: null,
      type: "video" as const,
      width: 1080,
      height: 1920,
    })),
    film,
    is_mine: false,
    visibility: "community",
  } as unknown as CommunityPost;

  it("each slide carries its own set, the photo none (never the first clip's on every slide)", () => {
    const slides = postSlides(post);
    expect(slides.map((s) => s.caption ?? null)).toEqual([
      null,
      // the weight as typed in the words, its other unit beside it (from the slide's stored kg)
      { title: "Competition Squat", detail: "Top set · 455 lb × 1 @ RPE 6", other: "206.4 kg" },
      { title: "Competition Squat", detail: "Backoff 3 · 375 lb × 4 @ RPE 6", other: "170.1 kg" },
      { title: "Close-Grip Block Press", detail: "Top set · 275 lb × 6 @ RPE 6", other: "124.7 kg" },
    ]);
    // a post that hides weights: the set without them
    expect(postSlides({ ...post, hide_loads: true } as CommunityPost)[3].caption).toEqual({
      title: "Close-Grip Block Press",
      detail: "Top set · 6 reps @ RPE 6",
      other: null,
    });
  });

  it("the card follows the slide on screen, per post, and the clip carries no caption on a screen", () => {
    const card = read("src/components/community/post-card.tsx");
    expect(card).toContain(
      'const slideSet = layout === "page" ? (postSlides(post)[screenSlide.id === post.id ? screenSlide.i : 0]?.caption ?? null) : null;',
    );
    expect(card).toMatch(/<PostMedia\s+post=\{post\}\s+thumbUrl=\{thumbUrl\}\s+page\s+shrunk=\{sheetOpen\}\s+onSlide=\{showSlide\}/);
    expect(card).toContain("onSlideRef.current?.(index - off);");
    expect(card).toContain(
      "{slide.caption && !shrunk && !page && <SlideCaption caption={slide.caption} withDots={withDots} />}",
    );
    // the order in the words (Nov 17 2026): who, their own words, then the workout's context (the set on screen,
    // then the workout chip that holds its PRs and opens it)
    const words = card.slice(card.indexOf("data-page-words-body>"), card.indexOf("data-page-meta"));
    const at = (m: string) => words.indexOf(m);
    expect(at("<AuthorLine")).toBeGreaterThan(0);
    expect(at("<PageCaption")).toBeGreaterThan(at("<AuthorLine"));
    expect(at("data-page-workout-context")).toBeGreaterThan(at("<PageCaption"));
    expect(at("data-page-set")).toBeGreaterThan(at("data-page-workout-context"));
    expect(at("data-page-workout\n")).toBeGreaterThan(at("data-page-set"));
    // their words at 15px, the workout's context a step smaller
    expect(read("src/components/community/page-caption.tsx")).toContain('"relative block w-full text-left text-[15px] leading-[1.4]"');
    expect(card).toContain('<div className="line-clamp-2 break-words text-[14px] font-medium">{slideSet.title}</div>');
  });

  it("the film's own summary caption isn't said again under the sets; their own words always are", () => {
    expect(
      isFilmSummary("Competition Squat 455 lb × 1 · Close-Grip Block Press 275 lb × 6", film),
    ).toBe(true);
    // a post that hides weights: names only
    expect(isFilmSummary("Competition Squat · Close-Grip Block Press", film)).toBe(true);
    expect(isFilmSummary("Competition Squat 455 lb × 1", film)).toBe(true);
    expect(isFilmSummary("squat felt fast today", film)).toBe(false);
    expect(isFilmSummary("Competition Squat 455 lb × 1 · new PR 💪", film)).toBe(false);
    expect(isFilmSummary("Competition Squat 460 lb × 1", film)).toBe(false);
    expect(isFilmSummary("", film)).toBe(false);
    expect(isFilmSummary("Competition Squat", [])).toBe(false);
    expect(isFilmSummary("Competition Squat", null)).toBe(false);
    expect(read("src/components/community/post-card.tsx")).toContain(
      "!(visual && isFilmSummary(post.caption, post.film)) && (",
    );
  });

  it("nothing shades the top of the clip any more; the words keep their one soft shade at the bottom", () => {
    const card = read("src/components/community/post-card.tsx");
    expect(card).not.toContain("bg-gradient-to-b from-black/65");
    expect(read("src/styles.css")).toContain(
      "background-image: linear-gradient(to top, rgb(0 0 0 / 0.75), rgb(0 0 0 / 0.35), transparent);",
    );
  });
});
