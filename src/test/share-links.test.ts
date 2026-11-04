import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHARE_DESCRIPTION, SHARE_IMAGE, SHARE_TITLE_MAX, SITE_NAME, legalShareTitle, shareImageMeta, shareMeta,
} from "@/lib/share-meta";

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") || p.endsWith(".ts") ? [p] : [];
  });
const routes = walk("src/routes").map((p) => ({ p, s: readFileSync(p, "utf8") }));
const content = (tags: ReturnType<typeof shareMeta>, key: string) =>
  tags.find((t) => ("property" in t ? t.property : t.name) === key)?.content;

describe("sent links show a short, clean card", () => {
  it("shareMeta writes the card's title and line for every app, and the page's own address", () => {
    const tags = shareMeta({ title: "Book a time with JF Effect", description: "Pick a time that works for you.", path: "/book/discovery" });
    expect(content(tags, "og:title")).toBe("Book a time with JF Effect");
    expect(content(tags, "twitter:title")).toBe("Book a time with JF Effect");
    expect(content(tags, "og:description")).toBe("Pick a time that works for you.");
    expect(content(tags, "twitter:description")).toBe("Pick a time that works for you.");
    expect(content(tags, "og:url")).toBe("https://jfeffect.com/book/discovery");
    expect(content(shareMeta({ title: SITE_NAME }), "og:description")).toBe(DEFAULT_SHARE_DESCRIPTION);
    expect(content(shareMeta({ title: SITE_NAME }), "og:url")).toBeUndefined();
  });

  it("the logo, as it is, at 1024px with its size so every app shows it on the first share", () => {
    const img = shareImageMeta();
    expect(content(img, "og:image")).toBe("https://jfeffect.com/icon-1024.png");
    expect(content(img, "og:image:width")).toBe("1024");
    expect(content(img, "og:image:height")).toBe("1024");
    expect(content(img, "twitter:image")).toBe(SHARE_IMAGE.url);
    expect(content(img, "twitter:card")).toBe("summary_large_image");
  });

  it("the root's card is just JF Effect, with no keywords and no og:url pointing every page home", () => {
    const root = readFileSync("src/routes/__root.tsx", "utf8");
    expect(root).toContain("...shareMeta({ title: SITE_NAME }),");
    expect(root).toContain("...shareImageMeta(),");
    expect(root).toContain('{ title: "JF Effect" },');
    expect(root).not.toContain('property: "og:url"');
    expect(root).not.toContain("Personal Trainer Selkirk MB & Online Fitness Coaching");
  });

  it("no page types its own share tags: they all come from shareMeta", () => {
    for (const { p, s } of routes) {
      for (const tag of ['property: "og:title"', 'property: "og:description"', 'name: "twitter:title"', 'name: "twitter:description"', 'property: "og:image"', 'name: "twitter:image"']) {
        expect(s.includes(tag), `${p} types ${tag}`).toBe(false);
      }
    }
  });

  it("every card's title is short and plain: no place names, keywords or separators", () => {
    const titles = routes.flatMap(({ p, s }) => [...s.matchAll(/shareMeta\(\{\s*title:\s*"([^"]+)"/g)].map((m) => ({ p, t: m[1] })));
    expect(titles.length).toBeGreaterThanOrEqual(20);
    for (const { p, t } of titles) {
      expect(t.length, `${p}: ${t}`).toBeLessThanOrEqual(SHARE_TITLE_MAX);
      expect(t, p).not.toMatch(/Selkirk|Winnipeg|Manitoba|\bMB\b|\||—|:/);
      expect(t, p).toMatch(/JF Effect|Jared McIntyre|Personal Training/);
    }
    // the booking link the coach texts leads
    expect(readFileSync("src/routes/book.$slug.tsx", "utf8")).toContain('shareMeta({ title: "Book a time with JF Effect"');
  });

  it("the router keeps the deepest page's tag for each name, so a page's card replaces the root's", () => {
    // headContentUtils walks the matches from the leaf up and keeps the first tag per name / property
    const router = readFileSync("node_modules/@tanstack/react-router/dist/esm/headContentUtils.js", "utf8");
    expect(router).toContain("for (let i = routeMeta.length - 1; i >= 0; i--)");
    expect(router).toContain("const attribute = m.name ?? m.property;");
    expect(router).toMatch(/if \(metaByAttribute\[attribute\]\) continue;/);
  });

  it("a legal document's card is its name", () => {
    expect(legalShareTitle("Privacy Policy")).toBe("JF Effect Privacy Policy");
    expect(legalShareTitle("JF Membership Agreement")).toBe("JF Membership Agreement");
    expect(legalShareTitle("  ")).toBe("JF Effect Legal");
  });
});
