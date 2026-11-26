import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  displayBox, filterLibrary, fromLibrary, isAllowedMediaUrl, mergeUnique, parseKlipy,
  postMediaKind, postMediaUrl, pushHistory, suggestFor, toSent, MEDIA_CATEGORIES, type LibraryRow,
} from "@/lib/media/media";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

const fmt = (url: string, w = 300, h = 200) => ({ url, width: w, height: h, size: 1000 });
const klipyItem = (slug: string, extra: Record<string, unknown> = {}) => ({
  id: 1, slug, title: ` ${slug} title `, type: "gif",
  blur_preview: "data:image/jpeg;base64,AAA",
  file: {
    hd: { gif: fmt(`https://static.klipy.com/ii/${slug}/hd.gif`, 498, 332) },
    md: {
      gif: fmt(`https://static.klipy.com/ii/${slug}/md.gif`),
      webp: fmt(`https://static.klipy.com/ii/${slug}/md.webp`),
      mp4: fmt(`https://static.klipy.com/ii/${slug}/md.mp4`),
    },
    sm: { webp: fmt(`https://static.klipy.com/ii/${slug}/sm.webp`, 150, 100), jpg: fmt(`https://static.klipy.com/ii/${slug}/sm.jpg`) },
    xs: { jpg: fmt(`https://static.klipy.com/ii/${slug}/xs.jpg`, 90, 60), png: fmt(`https://static.klipy.com/ii/${slug}/xs.png`) },
  },
  ...extra,
});

describe("media links", () => {
  it("only KLIPY's https CDN is referenced directly", () => {
    expect(isAllowedMediaUrl("https://static.klipy.com/ii/a/b.gif")).toBe(true);
    expect(isAllowedMediaUrl("https://klipy.com/x.webp")).toBe(true);
    expect(isAllowedMediaUrl("http://static.klipy.com/a.gif")).toBe(false);
    expect(isAllowedMediaUrl("https://evil.com/static.klipy.com/a.gif")).toBe(false);
    expect(isAllowedMediaUrl("https://static.klipy.com.evil.com/a.gif")).toBe(false);
    expect(isAllowedMediaUrl("https://user:pw@static.klipy.com/a.gif")).toBe(false);
    expect(isAllowedMediaUrl("https://static.klipy.com:8443/a.gif")).toBe(false);
    expect(isAllowedMediaUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedMediaUrl(null)).toBe(false);
  });
  it("the database enforces the same rule", () => {
    const sql = read("supabase/migrations/20270531120000_media_picker.sql");
    expect(sql).toContain("_url ~ '^https://([a-z0-9-]+\\.)*klipy\\.com/[^\\s@]*$'");
    expect(sql).toContain("IF NOT public.is_allowed_media_url(v_path) THEN RAISE EXCEPTION 'Pick a GIF or sticker from the picker'; END IF;");
    expect(sql).toContain("IF v_gif IS NOT NULL AND NOT public.is_allowed_media_url(v_gif) THEN");
  });
});

describe("KLIPY results", () => {
  it("become MediaItems with a light preview, a still and the shape", () => {
    const { items, hasNext } = parseKlipy({ result: true, data: { data: [klipyItem("abc")], has_next: true, current_page: 1 } }, "gif");
    expect(hasNext).toBe(true);
    expect(items).toHaveLength(1);
    const m = items[0];
    expect(m.ref).toBe("klipy:gif:abc");
    expect(m.title).toBe("abc title");
    expect(m.url).toBe("https://static.klipy.com/ii/abc/md.gif");
    expect(m.preview).toBe("https://static.klipy.com/ii/abc/sm.webp");
    expect(m.still).toBe("https://static.klipy.com/ii/abc/xs.jpg");
    expect(m.mp4).toBe("https://static.klipy.com/ii/abc/md.mp4");
    expect([m.width, m.height]).toEqual([300, 200]);
    expect(m.blur).toMatch(/^data:image\//);
  });
  it("stickers keep transparency (webp / png, never jpg or mp4)", () => {
    const { items } = parseKlipy({ data: { data: [klipyItem("st", { type: "sticker" })] } }, "sticker");
    expect(items[0].url).toBe("https://static.klipy.com/ii/st/md.webp");
    expect(items[0].still).toBe("https://static.klipy.com/ii/st/xs.png");
    expect(items[0].mp4).toBeNull();
    expect(items[0].kind).toBe("sticker");
  });
  it("drops ads, foreign links and broken rows", () => {
    const bad = klipyItem("x");
    (bad.file.md as any).gif.url = "https://ads.example.com/a.gif";
    (bad.file.md as any).webp.url = "https://ads.example.com/a.webp";
    const { items } = parseKlipy({
      data: { data: [{ type: "ad", file: {} }, bad, { slug: "", file: {} }, null, klipyItem("ok")] },
    }, "gif");
    expect(items.map((m) => m.providerId)).toEqual(["ok"]);
  });
  it("tolerates an empty or odd response", () => {
    expect(parseKlipy(null, "gif").items).toEqual([]);
    expect(parseKlipy({ data: [] }, "gif").items).toEqual([]);
    expect(parseKlipy({ data: { data: "nope" } }, "gif").items).toEqual([]);
  });
});

describe("the library", () => {
  const rows: LibraryRow[] = [
    { id: "1", title: "PR bell", category: "PR / Wins", tags: ["pr"], media_url: "https://media.tenor.com/a.gif", media_type: "image/gif", thumb_url: null },
    { id: "2", title: "Flex", category: "Custom", tags: ["bodybuilding"], media_url: "https://x/s.webp", media_type: "image/webp", thumb_url: null, kind: "sticker" },
  ];
  it("splits GIFs from stickers and matches the picker's categories", () => {
    expect(filterLibrary(rows, "gif", "", null).map((r) => r.id)).toEqual(["1"]);
    expect(filterLibrary(rows, "sticker", "", null).map((r) => r.id)).toEqual(["2"]);
    expect(filterLibrary(rows, "gif", "", "PRs").map((r) => r.id)).toEqual(["1"]);
    expect(filterLibrary(rows, "sticker", "", "Bodybuilding").map((r) => r.id)).toEqual(["2"]);
    expect(filterLibrary(rows, "gif", "bell", null)).toHaveLength(1);
    expect(filterLibrary(rows, "gif", "nothing", null)).toHaveLength(0);
  });
  it("rows keep a stable ref (favourites survive)", () => {
    expect(fromLibrary(rows[0]).ref).toBe("library:gif:1");
    expect(fromLibrary(rows[1]).ref).toBe("library:sticker:2");
  });
  it("the old favourites and recents are copied, never moved", () => {
    const sql = read("supabase/migrations/20270531120000_media_picker.sql");
    expect(sql).toContain("FROM public.chat_gif_favorites f");
    expect(sql).toContain("ON CONFLICT (user_id, ref) DO NOTHING;");
    expect(sql).not.toMatch(/DROP TABLE[^;]*chat_gif_(favorites|recent)/);
    expect(sql).not.toMatch(/DELETE FROM public\.chat_gif/);
  });
});

describe("picker helpers", () => {
  it("every requested category is there", () => {
    const labels = MEDIA_CATEGORIES.map((c) => c.label);
    for (const l of ["Gym", "Powerlifting", "Bodybuilding", "Motivation", "Discipline", "Hype", "PRs", "Celebration", "Respect", "Encouragement", "Funny", "Memes", "Reactions", "Relatable", "Shocked", "Laughing", "Sarcasm", "Fail", "Yes", "No", "Love"]) {
      expect(labels).toContain(l);
    }
  });
  it("pages merge without repeats", () => {
    const a = parseKlipy({ data: { data: [klipyItem("a"), klipyItem("b")] } }, "gif").items;
    const b = parseKlipy({ data: { data: [klipyItem("b"), klipyItem("c")] } }, "gif").items;
    expect(mergeUnique([a, b]).map((m) => m.providerId)).toEqual(["a", "b", "c"]);
  });
  it("suggestions: your own searches first, matching what's typed", () => {
    expect(suggestFor("dead", ["deadlift PR"])[0]).toBe("deadlift PR");
    expect(suggestFor("", ["mine"])[0]).toBe("mine");
    expect(suggestFor("lets go", [])).not.toContain("lets go");
    expect(pushHistory(["a b", "cc"], "CC")).toEqual(["CC", "a b"]);
    expect(pushHistory([], "x")).toEqual([]);
  });
  it("sent media keeps its shape, never wider than the cap, stickers a little smaller", () => {
    expect(displayBox(300, 150, 200)).toEqual({ width: 200, height: 100 });
    expect(displayBox(100, 400, 200)).toEqual({ width: 50, height: 200 });
    expect(displayBox(null, null, 200)).toEqual({ width: 200, height: 200 });
    expect(displayBox(200, 200, 200, "sticker").width).toBeLessThan(200);
  });
  it("a post's sticker is marked so it draws without a tile", () => {
    const m = parseKlipy({ data: { data: [klipyItem("s")] } }, "sticker").items[0];
    expect(postMediaUrl(m)).toBe("https://static.klipy.com/ii/s/md.webp#sticker");
    expect(postMediaKind(postMediaUrl(m))).toBe("sticker");
    expect(postMediaKind("https://static.klipy.com/a.gif")).toBe("gif");
    expect(toSent(m).preview).toBe("https://static.klipy.com/ii/s/sm.webp");
  });
});

describe("wiring", () => {
  it("the key stays on the server; users go to KLIPY as an opaque hash", () => {
    const server = read("src/lib/media/media.server.ts");
    expect(server).toContain('process.env.KLIPY_API_KEY');
    expect(server).toContain('createHash("sha256")');
    expect(read("src/lib/media/use-media.ts")).not.toContain("KLIPY_API_KEY");
    expect(read("src/components/gif-picker.tsx")).not.toContain("api.klipy.com");
  });
  it("one picker everywhere, stickers included", () => {
    for (const f of ["src/components/community/comments-sheet.tsx", "src/components/composer-plus-menu.tsx", "src/components/community/post-attach.tsx", "src/components/community/crew-stories.tsx"]) {
      expect(read(f)).toContain("<GifPicker");
    }
    expect(read("src/components/gif-picker.tsx")).toContain('kinds = ["gif", "sticker"]');
  });
  it("comments: stickers are accepted, drawn and recovered on failure; media-only allowed", () => {
    const sql = read("supabase/migrations/20270531120000_media_picker.sql");
    expect(sql).toContain("ARRAY['image', 'video', 'gif', 'sticker', 'audio']");
    expect(sql).toContain("IF v_body = '' AND v_path IS NULL THEN RAISE EXCEPTION");
    const sheet = read("src/components/community/comments-sheet.tsx");
    expect(sheet).toContain('if (m.type === "gif" || m.type === "sticker") {');
    expect(sheet).toContain("if (picked_) setGif((x) => x ?? picked_);");
    expect(read("src/lib/community.queries.ts")).toContain('type: c.gif.kind ?? "gif"');
  });
  it("chats send optimistically", () => {
    expect(read("src/components/message-thread.tsx")).toContain("mediaOnly: true, povConfirmed: true });");
    expect(read("src/components/group-message-thread.tsx")).toContain('const tempId = `optimistic-');
  });
  it("story replies can be a GIF or sticker, checked by the database", () => {
    const sql = read("supabase/migrations/20270531120000_media_picker.sql");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.picked_media_attachment(_media jsonb)");
    expect(sql).toContain("DROP FUNCTION public.community_message_author(uuid, text, boolean);");
    expect(read("src/lib/direct-chats.ts")).toContain("...(media ? { _media: media } : {})");
  });
});
