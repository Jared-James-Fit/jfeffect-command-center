import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  exerciseFromWin,
  postOpenFromHash,
  postOpenFromNotice,
  postOpenHash,
  slideForExercise,
  toPostOpen,
  withoutPostHash,
} from "@/lib/post-open";
import { postSlides } from "@/lib/community";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const ID = "7a2a5e97-1b2c-4d3e-8f90-a1b2c3d4e5f6";

// Jared's Nov 24 2026 film post, as stored: nine clips, the Belt Squat sets 5th and 6th
const film = [
  {
    path: "u/film/c/1.mp4",
    exercise: "Competition Squat",
    set: 1,
    set_name: "Top set",
    main: true,
    kg: 210.9,
    label: "465 lb × 1 @ RPE 8",
    label_no_load: "1 rep @ RPE 8",
  },
  {
    path: "u/film/c/2.mp4",
    exercise: "Competition Squat",
    set: 2,
    set_name: "Backoff",
    main: true,
    kg: 190.5,
    label: "420 lb × 3",
    label_no_load: "3 reps",
  },
  {
    path: "u/film/c/3.mp4",
    exercise: "2-Count Pause Bench Press",
    set: 1,
    kg: 120,
    label: "265 lb × 3",
    label_no_load: "3 reps",
  },
  {
    path: "u/film/c/4.mp4",
    exercise: "2-Count Pause Bench Press",
    set: 2,
    kg: 113.4,
    label: "250 lb × 4",
    label_no_load: "4 reps",
  },
  {
    path: "u/film/c/5.mp4",
    exercise: "Belt Squat",
    set: 1,
    kg: 108.9,
    label: "240 lb × 12",
    label_no_load: "12 reps",
  },
  {
    path: "u/film/c/6.mp4",
    exercise: "Belt Squat",
    set: 2,
    kg: 117.9,
    label: "260 lb × 12",
    label_no_load: "12 reps",
  },
  {
    path: "u/film/c/7.mp4",
    exercise: "Pull Up Wide Grip",
    set: 1,
    kg: 13.6,
    label: "30 lb × 12",
    label_no_load: "12 reps",
  },
  {
    path: "u/film/c/8.mp4",
    exercise: "Cable Hip Adduction",
    set: 1,
    kg: 11.3,
    label: "25 lb × 20",
    label_no_load: "20 reps",
  },
  {
    path: "u/film/c/9.mp4",
    exercise: "Cable Triceps Pushdown",
    set: 1,
    kg: 27.2,
    label: "60 lb × 15",
    label_no_load: "15 reps",
  },
];
const post = {
  media_path: film[0].path,
  media_thumb_path: "u/film/c/1.jpg",
  media_type: "video" as const,
  media_width: 1080,
  media_height: 1920,
  extra_media: film
    .slice(1)
    .map((f) => ({ path: f.path, thumb: null, type: "video" as const, width: 1080, height: 1920 })),
  film,
};

describe("Where a post opens (post-open.ts)", () => {
  it("reads the exercise a PR notice is about, never a milestone", () => {
    expect(exerciseFromWin("Belt Squat PR")).toBe("Belt Squat");
    expect(exerciseFromWin(" 2-Count Pause Bench Press PR ")).toBe("2-Count Pause Bench Press");
    expect(exerciseFromWin("10th session this month")).toBeNull();
    expect(exerciseFromWin("3rd session this week")).toBeNull();
    expect(exerciseFromWin(null)).toBeNull();
    expect(exerciseFromWin("PR")).toBeNull();
  });

  it("a like on a PR opens on that set; a comment opens with the comments up; a follow opens no post", () => {
    expect(postOpenFromNotice({ kind: "reaction", post_id: ID, win: "Belt Squat PR" })).toEqual({
      id: ID,
      exercise: "Belt Squat",
    });
    expect(
      postOpenFromNotice({ kind: "reaction", post_id: ID, win: "10th session this month" }),
    ).toEqual({ id: ID });
    expect(postOpenFromNotice({ kind: "repost", post_id: ID, win: "Belt Squat PR" })).toEqual({
      id: ID,
      exercise: "Belt Squat",
    });
    expect(postOpenFromNotice({ kind: "comment", post_id: ID, win: "Belt Squat PR" })).toEqual({
      id: ID,
      sheet: "comments",
    });
    expect(postOpenFromNotice({ kind: "reply", post_id: ID })).toEqual({
      id: ID,
      sheet: "comments",
    });
    expect(postOpenFromNotice({ kind: "comment_like", post_id: ID })).toEqual({
      id: ID,
      sheet: "comments",
    });
    expect(postOpenFromNotice({ kind: "follow", post_id: null })).toBeNull();
  });

  it("opens on the slide of that exercise's heaviest filmed set, else the first", () => {
    const slides = postSlides(post);
    expect(slides).toHaveLength(9);
    // Belt Squat 260 lb × 12 is the 6th slide (index 5), past the 240 lb set
    expect(slideForExercise(slides, film, "Belt Squat")).toBe(5);
    expect(slideForExercise(slides, film, "belt  squat")).toBe(5);
    expect(slideForExercise(slides, film, "Competition Squat")).toBe(0);
    expect(slideForExercise(slides, film, "Cable Hip Adduction")).toBe(7);
    // nothing of it on film, no film, one slide, no exercise: the first
    expect(slideForExercise(slides, film, "Romanian Deadlift")).toBe(0);
    expect(slideForExercise(slides, null, "Belt Squat")).toBe(0);
    expect(slideForExercise(slides.slice(0, 1), film, "Belt Squat")).toBe(0);
    expect(slideForExercise(slides, film, null)).toBe(0);
  });

  it("a link, a push and the bell say the same thing in the hash, and read it back", () => {
    expect(postOpenHash({ id: ID })).toBe(`post=${ID}`);
    const h = postOpenHash({ id: ID, exercise: "Belt Squat" });
    expect(h).toBe(`post=${ID}&ex=Belt%20Squat`);
    expect(postOpenFromHash(`#${h}`)).toEqual({ id: ID, exercise: "Belt Squat" });
    expect(postOpenFromHash(`#post=${ID}&sheet=comments`)).toEqual({ id: ID, sheet: "comments" });
    // an older link: just the post
    expect(postOpenFromHash(`#post=${ID.toUpperCase()}`)).toEqual({ id: ID });
    // a router that hands the hash back decoded still reads
    expect(postOpenFromHash(`post=${ID}&ex=Belt Squat`)).toEqual({
      id: ID,
      exercise: "Belt Squat",
    });
    expect(postOpenFromHash("#rankings")).toBeNull();
    expect(postOpenFromHash("#post=not-a-post")).toBeNull();
    expect(withoutPostHash(`#post=${ID}&ex=Belt%20Squat&sheet=comments`)).toBe("");
    expect(withoutPostHash(`#tab=needs&post=${ID}`)).toBe("#tab=needs");
  });

  it("the open-a-post event takes an id or where to open it, and nothing else", () => {
    expect(toPostOpen(ID)).toEqual({ id: ID });
    expect(toPostOpen({ id: ID, exercise: " Belt Squat ", sheet: "comments" })).toEqual({
      id: ID,
      exercise: "Belt Squat",
      sheet: "comments",
    });
    expect(toPostOpen({ id: ID, sheet: "likes" })).toEqual({ id: ID });
    expect(toPostOpen("nope")).toBeNull();
    expect(toPostOpen(null)).toBeNull();
    expect(toPostOpen({ id: 4 })).toBeNull();
  });
});

describe("A post opens on its own screen, as the feed shows it, never the old workout page", () => {
  const screen = read("src/components/community/community-screen.tsx");
  const activity = read("src/components/community/crew-activity.tsx");
  it("Activity opens the post the line is about, on the slide it names", () => {
    expect(activity).toContain("const target = postOpenFromNotice(it);");
    expect(activity).toContain("onOpenPost: (open: PostOpen) => void;");
    expect(screen).toContain("onOpenPost={showPost}");
  });
  it("the post's screen is the feed's own (PostRow layout=page), placed on its slide before its carousel mounts", () => {
    expect(screen).toContain("function PostScreen(");
    expect(screen).toMatch(
      /<div ref=\{pageRef\} data-post-id=\{open\.id\} className="feed-page">\s*\{post \? \(\s*<PostRow/,
    );
    expect(screen).toContain(
      "rememberCarouselPlace(`page:${post.id}`, isAutoPost(post) ? 0 : slideForExercise(postSlides(post), post.film, open.exercise));",
    );
    // the page it was opened from stays mounted under it, and ‹ back lands on it where it was
    expect(screen).toContain("<div\n        hidden={!!postOpen}");
    expect(screen).toContain("restoreY.current = sc.y;");
    expect(screen).toContain(
      '<CrewBar label="Post" overlay left={<BarBack label={`Back to ${TAB_LABEL[tab]}`} onClick={leavePost} />} />',
    );
  });
  it("pushes, the bell, links, story View post, profile grids and the coach's Manage all go there", () => {
    expect(screen).toContain("const open = postOpenFromHash(`#${routeHash}`);");
    expect(screen).toContain("showPostRef.current((e as CustomEvent<string | PostOpen>).detail);");
    expect(screen).toContain("} else showPost(jumpTo);");
    expect(screen).not.toContain("onOpenPost={(id) => setDetailId(id)}");
    expect(read("src/lib/push/community-push.server.ts")).toContain(
      "url: `${base}#${postOpenHash(postOpenFromNotice(n) ?? { id: n.post_id })}`",
    );
    expect(read("src/components/notification-bell.tsx")).toContain(
      "openCommunityPost(it.postOpen ?? it.postId!)",
    );
    for (const f of ["admin-community-hub", "post-score-board"]) {
      const src = read(`src/components/community/${f}.tsx`);
      expect(src).not.toContain("PostDetailDialog");
      expect(src).toContain("openCommunityPost(");
    }
    // only the finance login's feed of cards (no bar of its own) still opens the workout page
    expect(screen).toContain(
      "const [detailId, setDetailId] = useState<string | null>(() => (hideTabs ? postFromHash() : null));",
    );
    expect(screen).toContain("if (hideTabs) return setDetailId(open.id);");
  });
  it("a post's screen never sends anyone to another page: more of the post is its sheet", () => {
    expect(screen).toContain(
      'const openMore = useCallback((p: CommunityPost) => setSheet({ post: p, at: p.stats ? "workout" : "caption" }), []);',
    );
    expect(screen).toMatch(/onOpen=\{openMore\}\s*onOpenComments=\{openCommentsSheet\}/);
  });
});
