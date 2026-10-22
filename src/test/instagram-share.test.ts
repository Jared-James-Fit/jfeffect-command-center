import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  IG_CAPTION_MAX,
  instagramCaption,
  instagramFileName,
  instagramHeadsUp,
  instagramPlan,
  instagramTags,
  mediaType,
  plainMentions,
  sendToInstagram,
  toggleTags,
  withTags,
} from "@/lib/instagram-export";
import { wordsCardText } from "@/lib/instagram-cards";
import type { CommunityPost } from "@/lib/community";

const read = (f: string) => readFileSync(f, "utf8");
const jared = { user_id: "j", name: "Jared McIntyre", avatar_url: null, is_coach: true };
const marc = { user_id: "m", name: "Marc Smith", avatar_url: null, is_coach: false, username: "marc_lifts", text: "@marc_lifts" };
const post = (x: Partial<CommunityPost> & Record<string, unknown> = {}) =>
  ({ id: "p", created_at: "2026-10-21T21:00:00Z", kind: "note", is_mine: true, author: jared, caption: null, media_path: null, media_thumb_path: null, media_type: null, media_width: null, media_height: null, stats: null, ...x }) as unknown as CommunityPost;
const lesson = (visual: unknown, extra: Record<string, unknown> = {}) =>
  post({ series: "lesson", caption: "If you need to be sore to feel like it worked, you're grading the wrong thing\n\nSoreness mostly shows up when the work is new.", series_extra: { track: "truth", title: "Soreness isn't proof it worked", visual } as never, ...extra });
const wins = { week_of: "2026-09-28", roster: 16, opened: 15, trained: 12, sessions: 36, sessions_prev: 32, prs: 41, pr_people: 9, volume_kg: 204215, reps: 6015, streaks: 10, bodyweight: 9, checkins: 4, busiest_day: "Friday" };
const recap = { ...wins, kind: "recap", planned: 43, planned_done: 35, hit: 7, active: 12, days: [8, 3, 5, 4, 9, 3, 4], completed: 36, fully_logged: 25, top: [{ name: "Reecey", type: "atpr", text: "Reecey hit 265 x 8" }], improve: null };

describe("Share to Instagram: what goes out", () => {
  it("a post's own photos / clips as posted; a lesson its card first, then any photo on it; everything else a painted card", () => {
    const photo = post({ media_path: "u/a.jpg", media_type: "image", extra_media: [{ path: "u/b.mp4", thumb: null, type: "video", width: 1080, height: 1920 }] } as never);
    expect(instagramPlan(photo)).toMatchObject({ card: null, slides: [{ path: "u/a.jpg" }, { path: "u/b.mp4" }] });
    expect(instagramPlan(lesson({ kind: "truth", belief: "a", truth: "b" }))).toEqual({ card: "lesson", slides: [] });
    expect(instagramPlan(lesson(null, { media_path: "c/cover.jpg", media_type: "image" }))).toMatchObject({ card: "lesson", slides: [{ path: "c/cover.jpg" }] });
    expect(instagramPlan(post({ series: "sunday_recap", series_data: recap as never })).card).toBe("recap");
    expect(instagramPlan(post({ series: "wednesday_wins", series_data: wins as never })).card).toBe("wins");
    expect(instagramPlan(post({ series: "holiday", series_extra: { holiday: "x", name: "Thanksgiving", image: "/holidays/thanksgiving.jpg" } as never })).card).toBe("holiday");
    // a holiday photo from anywhere but the app's own files is never fetched
    expect(instagramPlan(post({ series: "holiday", series_extra: { holiday: "x", name: "X", image: "https://evil.example/x.jpg" } as never })).card).toBe("words");
    expect(instagramPlan(post({ series: "saturday_spirit", series_extra: { scene: "summit" } as never })).card).toBe("scene");
    expect(instagramPlan(post({ kind: "workout", stats: { exercises: [] } as never })).card).toBe("workout");
    expect(instagramPlan(post({ caption: "Deload week isn't a week off" })).card).toBe("words");
  });

  it("names files by the post's day, in the order they go", () => {
    expect(instagramFileName(post(), 0, "image/jpeg")).toBe("jfeffect-2026-10-21-1.jpg");
    expect(instagramFileName(post(), 2, "video/quicktime")).toBe("jfeffect-2026-10-21-3.mov");
    expect(mediaType("", "u/clip.MOV", "video")).toBe("video/quicktime");
    expect(mediaType("application/octet-stream", "u/a.jpeg", "image")).toBe("image/jpeg");
    expect(mediaType("image/png", "u/a.jpg", "image")).toBe("image/png");
  });
});

describe("Share to Instagram: the caption", () => {
  it("anyone it tags reads as their plain first name (an in-app @username would tag a stranger on Instagram)", () => {
    expect(plainMentions("@marc_lifts hit 405 and @marc_lifts again", [marc] as never)).toBe("Marc hit 405 and Marc again");
    expect(plainMentions("Big week for Marc Smith", [{ ...marc, text: "Marc Smith" }] as never)).toBe("Big week for Marc");
    // an @ the coach typed for a real Instagram account stays
    expect(plainMentions("follow @jfeffect", [marc] as never)).toBe("follow @jfeffect");
  });

  it("a quote and who said it, then the words, then the hashtags on their own line", () => {
    const p = post({ series: "monday_motivation", quote: "Do the work.", quote_author: "Someone", caption: "Monday. @marc_lifts knows", mentions: [marc] as never });
    const text = instagramCaption(p, { tags: true });
    expect(text.startsWith("“Do the work.”\nSomeone\n\nMonday. Marc knows\n\n#")).toBe(true);
    expect(text.endsWith("#jfeffect")).toBe(true);
    expect(instagramCaption(p, { tags: false })).toBe("“Do the work.”\nSomeone\n\nMonday. Marc knows");
  });

  it("hashtags fit the post (a lesson by its day), always end with the brand's, and switch off without touching his edits", () => {
    expect(instagramTags(lesson(null))).toEqual(["#strengthtraining", "#fitnessmindset", "#gymtruths", "#jfeffect"]);
    expect(instagramTags(post({ series_data: wins as never }))[0]).toBe("#strengthcommunity");
    const tags = "#a #b";
    const edited = `${withTags("my words", tags)}`.replace("my words", "my words, edited");
    expect(toggleTags(edited, tags, false)).toBe("my words, edited");
    expect(toggleTags("my words, edited", tags, true)).toBe("my words, edited\n\n#a #b");
    expect(toggleTags("my words, edited\n\n#a #b", tags, true)).toBe("my words, edited\n\n#a #b");
  });

  it("never longer than Instagram takes (2,200), and the hashtags still fit", () => {
    const long = withTags("x".repeat(3000), "#jfeffect");
    expect(long.length).toBeLessThanOrEqual(IG_CAPTION_MAX);
    expect(long.endsWith("\n\n#jfeffect")).toBe(true);
    expect(withTags("", "#jfeffect")).toBe("#jfeffect");
  });

  it("a heads-up when it shows someone else: their post, or names in it", () => {
    expect(instagramHeadsUp(post({ is_mine: false, author: { user_id: "v", name: "Vicky Lee", avatar_url: null, is_coach: false } }))).toBe("This is Vicky's post. Make sure they're good with it going on your Instagram.");
    expect(instagramHeadsUp(post({ mentions: [marc] as never }))).toBe("It names Marc. Make sure they're good with it going public.");
    expect(instagramHeadsUp(post({ series: "sunday_recap", series_data: recap as never }))).toMatch(/biggest moments name people/);
    // Wins is counts only: nobody singled out
    expect(instagramHeadsUp(post({ series: "wednesday_wins", series_data: wins as never }))).toBeNull();
    expect(instagramHeadsUp(post({ caption: "Deload week" }))).toBeNull();
  });

  it("a words card leads with the first line (the hook), or the quote and who said it", () => {
    expect(wordsCardText(post({ caption: "\nDeload week isn't a week off\n\nSame lifts, lighter." }))).toEqual({ head: "Deload week isn't a week off", body: "Same lifts, lighter.", by: null });
    expect(wordsCardText(post({ quote: "Do the work.", quote_author: "Someone", caption: "x" }))).toEqual({ head: "“Do the work.”", body: null, by: "Someone" });
  });
});

describe("Share to Instagram: the one tap", () => {
  const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
  const order: string[] = [];
  const stub = (opts: { ua: string; share?: (d: unknown) => Promise<void>; canShare?: boolean; write?: () => Promise<void> }) => {
    order.length = 0;
    vi.stubGlobal("navigator", {
      userAgent: opts.ua,
      maxTouchPoints: 5,
      clipboard: { writeText: vi.fn(() => (order.push("copy"), opts.write ? opts.write() : Promise.resolve())) },
      ...(opts.share ? { share: vi.fn((d: unknown) => (order.push("share"), opts.share!(d))), canShare: () => opts.canShare ?? true } : {}),
    });
    const a = { click: vi.fn(() => order.push("download")), remove: vi.fn(), href: "", download: "" };
    vi.stubGlobal("document", { createElement: () => a, body: { appendChild: vi.fn() }, activeElement: null, execCommand: () => false });
    vi.stubGlobal("window", { setTimeout: (f: () => void) => (f(), 0) });
  };
  afterEach(() => vi.unstubAllGlobals());
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)";

  it("on a phone: copies the caption, then opens the share sheet with the files, both in the tap", async () => {
    stub({ ua: iphone, share: async () => {} });
    expect(await sendToInstagram([file], "caption")).toEqual({ outcome: "shared", copied: true });
    expect(order).toEqual(["copy", "share"]);
  });

  it("closed without picking is just cancelled; a phone that won't open the sheet from this tap asks for one more (caption already copied)", async () => {
    stub({ ua: iphone, share: () => Promise.reject(Object.assign(new Error("x"), { name: "AbortError" })) });
    expect((await sendToInstagram([file], "c")).outcome).toBe("cancelled");
    stub({ ua: iphone, share: () => Promise.reject(Object.assign(new Error("x"), { name: "NotAllowedError" })) });
    expect(await sendToInstagram([file], "c")).toEqual({ outcome: "again", copied: true });
    // the second tap only shares
    stub({ ua: iphone, share: async () => {} });
    expect(await sendToInstagram([file], null)).toEqual({ outcome: "shared", copied: false });
    expect(order).toEqual(["share"]);
  });

  it("on a computer (no Instagram in its share sheet): saves the files and copies the caption", async () => {
    stub({ ua: "Mozilla/5.0 (Windows NT 10.0)", share: async () => {} });
    expect(await sendToInstagram([file, file], "c")).toEqual({ outcome: "saved", copied: true });
    expect(order.filter((o) => o === "download")).toHaveLength(2);
    expect(order).not.toContain("share");
  });
});

describe("Share to Instagram: where it is", () => {
  it("coaches only, on any post's ⋯ and its ✈️, never in View as client and never on a story", () => {
    const actions = read("src/components/community/post-actions.tsx");
    expect(actions).toContain("const canInstagram = viewerIsStaff && !isImpersonating && !post.story;");
    expect(actions).toContain("{canInstagram && ig !== null && <InstagramShareSheet post={post} open={ig} onOpenChange={setIg} />}");
    const card = read("src/components/community/post-card.tsx");
    expect(card).toContain('const canInstagram = (role === "admin" || role === "coach") && !isImpersonating && !post.story;');
    expect(card).toContain("onInstagram={canInstagram ? () => window.setTimeout(() => setIg(true), 200) : undefined}");
  });

  it("the files are made before the tap, and only files made for exactly what's chosen can go", () => {
    const sheet = read("src/components/community/instagram-share-sheet.tsx");
    expect(sheet).toContain("const ready = prepared?.key === prepKey && !!items?.length && !failed;");
    expect(sheet).toContain("void sendToInstagram(files, copiedOnce ? null : caption)");
    // a refetch of the same post never resets the caption being edited
    expect(sheet).toContain("}, [open, post.id]);");
  });

  it("cards are canvas only, a diagram comes in as pure SVG (an iPhone refuses to save a canvas with HTML drawn in)", () => {
    const cards = read("src/lib/instagram-cards.ts");
    expect(cards).not.toContain("foreignObject");
    expect(cards).toContain('copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");');
    expect(cards).toContain("out = out.replace(/var\\((--[\\w-]+)\\)/g, (m, name: string) => vars[name] ?? m);");
  });
});
