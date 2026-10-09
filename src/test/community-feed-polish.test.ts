import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCommentPreview, pinnedFirst } from "@/lib/community";
import { capViewport } from "@/hooks/use-no-auto-zoom";

const author = (name: string) => ({ user_id: name, name, avatar_url: null, is_coach: false });
const c = (id: string, at: string, extra: Record<string, unknown> = {}) => ({ id, created_at: at, body: `body ${id}`, author: author(id), parent_id: null, hidden: false, media: null, ...extra });

describe("share studio: no iOS focus-zoom", () => {
  it("caps the viewport at 1x without dropping the rest", () => {
    expect(capViewport("width=device-width, initial-scale=1, viewport-fit=cover")).toBe("width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1");
    expect(capViewport("width=device-width, maximum-scale=5")).toBe("width=device-width, maximum-scale=1");
  });
  it("is on for the whole studio and for the text tool", () => {
    expect(readFileSync("src/components/community/share-studio.tsx", "utf8")).toMatch(/useNoAutoZoom\(open\)/);
    expect(readFileSync("src/components/community/sticker-layer.tsx", "utf8")).toMatch(/useNoAutoZoom\(!!editing\)/);
  });
});

describe("feed comment preview", () => {
  const list = [
    c("a", "2026-10-08T10:00:00Z"),
    c("b", "2026-10-08T11:00:00Z"),
    c("r", "2026-10-08T12:00:00Z", { parent_id: "a" }),
    c("h", "2026-10-08T13:00:00Z", { hidden: true }),
    c("d", "2026-10-08T09:00:00Z", { body: "", media: { type: "image" } }),
  ];
  it("two lines at most: newest top-level, never replies or hidden ones", () => {
    expect(buildCommentPreview(list as any, null).map((x) => x.id)).toEqual(["b", "a"]);
  });
  it("the pinned comment always comes first", () => {
    const p = buildCommentPreview(list as any, "d");
    expect(p.map((x) => x.id)).toEqual(["d", "b"]);
    expect(p[0]).toMatchObject({ pinned: true, media: true });
  });
  it("the sheet moves the pinned thread to the top and keeps the rest in order", () => {
    const threads = ["a", "b", "c"].map((id) => ({ comment: { id } }));
    expect(pinnedFirst(threads, "c").map((t) => t.comment.id)).toEqual(["c", "a", "b"]);
    expect(pinnedFirst(threads, null).map((t) => t.comment.id)).toEqual(["a", "b", "c"]);
  });
  it("only the person who posted can pin, server-side", () => {
    const sql = readFileSync("supabase/migrations/20261021090000_community_pinned_comment_preview.sql", "utf8");
    expect(sql).toMatch(/p\.author_user_id = v_me/);
    expect(sql).toMatch(/LIMIT 2/);
    expect(sql).toMatch(/c\.hidden_at IS NULL/);
  });
});

describe("view full workout", () => {
  it("every workout card has the row, with a first-time demo remembered on the account", () => {
    const card = readFileSync("src/components/community/post-card.tsx", "utf8");
    expect(card).toMatch(/<ViewWorkoutRow post=\{post\}/);
    expect(card).toMatch(/<CommentPreviewList post=\{post\}/);
    const screen = readFileSync("src/components/community/community-screen.tsx", "utf8");
    expect(screen).toMatch(/markHint\(OPEN_HINT\)/);
    expect(screen).toMatch(/openHint=\{p\.id === openHintId\}/);
    expect(screen).not.toMatch(/localStorage/);
  });
});
