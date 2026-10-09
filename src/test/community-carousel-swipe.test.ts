import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_SLIDES, MAX_SLIDE_VIDEOS, fitSlides, postFiles, postSlides, slideThumbPath } from "@/lib/community";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261020090000_community_carousel.sql");
const studio = read("src/components/community/share-studio.tsx");
const tray = read("src/components/community/slide-tray.tsx");
const card = read("src/components/community/post-card.tsx");
const swipe = read("src/components/swipe-back.tsx");
const screen = read("src/components/community/community-screen.tsx");
const queries = read("src/lib/community.queries.ts");

const img = { kind: "image" as const };
const vid = { kind: "video" as const };

describe("carousel limits", () => {
  it("10 on a post, 3 of them videos", () => {
    expect(MAX_SLIDES).toBe(10);
    expect(MAX_SLIDE_VIDEOS).toBe(3);
  });

  it("keeps the order and stops at 10", () => {
    const picked = Array.from({ length: 12 }, (_, i) => ({ ...img, n: i }));
    const fit = fitSlides([img], picked);
    expect(fit.take.map((p) => p.n)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(fit.dropped).toBe(3);
    expect(fit.reason).toBe("Up to 10 photos and videos on a post");
  });

  it("skips a 4th video but keeps the photos after it", () => {
    const fit = fitSlides([img, vid], [vid, vid, { ...vid, n: "x" }, { ...img, n: "y" }]);
    expect(fit.take.map((p) => p.kind)).toEqual(["video", "video", "image"]);
    expect(fit.reason).toBe("Up to 3 videos on a post");
  });

  it("nothing dropped, no message", () => {
    expect(fitSlides([], [img, vid]).reason).toBeNull();
  });
});

describe("a post's slides", () => {
  const post = {
    media_path: "u/a.jpg", media_thumb_path: "u/a_t.jpg", media_type: "image" as const, media_width: 1080, media_height: 1350,
    extra_media: [
      { path: "u/b.mp4", thumb: "u/b_t.jpg", type: "video" as const, width: 720, height: 1280 },
      { path: "u/c.jpg", thumb: null, type: "image" as const, width: null, height: null },
    ],
  };
  it("cover first, then the rest in order", () => {
    expect(postSlides(post).map((s) => s.path)).toEqual(["u/a.jpg", "u/b.mp4", "u/c.jpg"]);
  });
  it("no photo, no slides (older posts without extras are one slide)", () => {
    expect(postSlides({ ...post, media_path: null, media_type: null })).toEqual([]);
    expect(postSlides({ ...post, extra_media: null })).toHaveLength(1);
  });
  it("small: the thumbnail, else the photo, never a raw video", () => {
    expect(slideThumbPath(post.extra_media[0])).toBe("u/b_t.jpg");
    expect(slideThumbPath(post.extra_media[1])).toBe("u/c.jpg");
    expect(slideThumbPath({ path: "u/v.mp4", thumb: null, type: "video" })).toBeNull();
  });
  it("every file, for tidying up after a delete", () => {
    expect(postFiles(post)).toEqual(["u/a.jpg", "u/a_t.jpg", "u/b.mp4", "u/b_t.jpg", "u/c.jpg"]);
  });
});

describe("carousel on the server", () => {
  it("at most 9 more slides, only the poster's own files, at most 3 videos", () => {
    expect(sql).toMatch(/jsonb_array_length\(extra_media\) <= 9/);
    expect(sql).toMatch(/left\(e->>'path', length\(v_prefix\)\) <> v_prefix/);
    expect(sql).toMatch(/RAISE EXCEPTION 'Up to 3 videos on a post'/);
    expect(sql).toMatch(/RAISE EXCEPTION 'Up to 10 photos or videos on a post'/);
  });
  it("older app saves (no slides argument) keep the slides; slides without a cover promote the first", () => {
    expect(sql).toMatch(/_extra_media jsonb DEFAULT NULL/);
    expect(sql).toMatch(/WHEN v_extra IS NOT NULL THEN v_extra ELSE p\.extra_media END/);
    expect(sql).toMatch(/extra_media = p\.extra_media - 0/);
  });
  it("the feed gets the other slides", () => {
    expect(sql).toMatch(/'extra_media', CASE WHEN jsonb_array_length\(n\.extra_media\) > 0 THEN n\.extra_media END/);
  });
});

describe("storage read rule never trips on a column grant", () => {
  // The rule is part of every signed-in file read. A subquery in it that
  // touches a column the reader can't see fails every read (it happened:
  // community_comments.hidden_at). Lookups go through definer functions.
  const files = readdirSync(new URL("../../supabase/migrations/", import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
  const latest = files.filter((f) => read(`supabase/migrations/${f}`).includes('CREATE POLICY "community media read"')).pop()!;
  const body = read(`supabase/migrations/${latest}`);
  const policy = body.slice(body.lastIndexOf('CREATE POLICY "community media read"'));
  const rule = policy.slice(0, policy.indexOf(");") + 2);
  it("the newest version uses the lookup functions only", () => {
    expect(rule).toMatch(/community_post_media_readable\(objects\.name\)/);
    expect(rule).toMatch(/community_comment_media_readable\(objects\.name\)/);
    expect(rule).not.toMatch(/FROM public\./);
  });
  it("both lookups are security definer", () => {
    const all = files.map((f) => read(`supabase/migrations/${f}`)).join("\n");
    for (const fn of ["community_post_media_readable", "community_comment_media_readable"]) {
      const at = all.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
      expect(all.slice(at, at + 200), fn).toMatch(/SECURITY DEFINER/);
    }
  });
});

describe("carousel composer", () => {
  it("camera first; the library picks several at once", () => {
    expect(studio).toMatch(/<input ref=\{libRef\} type="file" accept=\{accept\} multiple hidden/);
    // the first photo gets the card, everything else follows it
    expect(studio).toMatch(/const heroAt = files\.findIndex\(\(x\) => !isVideo\(x\)\)/);
  });
  it("extras upload as they're added (3 at a time); Post only waits for what's still going", () => {
    expect(tray).toMatch(/const PARALLEL = 3/);
    expect(studio).toMatch(/const extras = await tray\.ready\(\);/);
    expect(studio).toMatch(/tray\.commit\(\);/);
  });
  it("closing without posting throws the new uploads away", () => {
    expect(studio).toMatch(/if \(!postedRef\.current\) tray\.discard\(\);/);
    expect(tray).toMatch(/const discard = useCallback/);
  });
  it("replacing slides tidies up the files the post no longer uses", () => {
    expect(queries).toMatch(/const gone = postFiles\(old\)\.filter\(\(p\) => !keep\.has\(p\)\);/);
  });
});

describe("carousel viewer", () => {
  it("snaps one at a time, shows where you are, loads only nearby slides", () => {
    expect(card).toMatch(/snap-x snap-mandatory overflow-x-auto/);
    expect(card).toMatch(/\{index \+ 1\}\/\{slides\.length\}/);
    expect(card).toMatch(/const near = Math\.abs\(i - index\) <= 1 \|\| i < seen;/);
    // no rubber-band at the ends, so a back swipe on slide 1 is clean
    expect(card).toMatch(/overscrollBehaviorX: "none"/);
  });
});

describe("swipe back", () => {
  it("works from anywhere but the phone's own edge zone", () => {
    expect(swipe).toMatch(/const EDGE_PX = 24;/);
    expect(swipe).toMatch(/if \(t\.clientX < EDGE_PX \|\| sheetOpen\(\) \|\| blocked\(e\.target\)\) return;/);
  });
  it("only takes sideways-right swipes, and only then stops scrolling", () => {
    expect(swipe).toMatch(/if \(ddx > 0 && ddx > Math\.abs\(ddy\) \* 1\.3\) mode = "back";/);
    expect(swipe).toMatch(/if \(e\.cancelable\) e\.preventDefault\(\);/);
    expect(swipe).toMatch(/document\.addEventListener\("touchmove", onMove, \{ passive: false \}\);/);
  });
  it("a carousel past its first photo keeps the swipe", () => {
    expect(swipe).toMatch(/if \(n\.scrollLeft > 0 && n\.scrollWidth > n\.clientWidth\) return true;/);
  });
  it("goes back for real when there's history, else to Home; a profile goes back to the list", () => {
    expect(screen).toMatch(/if \(router\.history\.canGoBack\(\)\) router\.history\.back\(\);/);
    expect(screen).toMatch(/if \(scope\.kind === "author"\) return leaveAuthor\(\);/);
  });
  it("the demo asks until it's used once (remembered on the account), at most 5 visits", () => {
    expect(screen).toMatch(/const SWIPE_TIP_VISITS = 5;/);
    expect(screen).toMatch(/markHint\("swipe_back"\);/);
    expect(screen).toMatch(/!hints\.data\.includes\("swipe_back"\)/);
  });
});
