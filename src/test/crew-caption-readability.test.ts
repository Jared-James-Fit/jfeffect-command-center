import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { captionParagraphs } from "@/lib/caption-preview";

const sql = readFileSync(new URL("../../supabase/migrations/20270430100000_crew_caption_readability.sql", import.meta.url), "utf8");

/** Every (id, old md5, new caption) row the migration writes. */
function rows(): { id: string; md5: string; caption: string }[] {
  const out: { id: string; md5: string; caption: string }[] = [];
  for (const m of sql.matchAll(/\('([0-9a-f-]{36})'::uuid, '([0-9a-f]{32})', '((?:[^']|'')*)'\)/g)) {
    out.push({ id: m[1], md5: m[2], caption: m[3].replace(/''/g, "'").replace(/\\n/g, "\n") });
  }
  return out;
}

describe("the automated captions already out, and the library's next ones, read on a phone (Nov 21 2026)", () => {
  const all = rows();

  it("rewrites the 31 posts that went out as one block and the 65 library decks", () => {
    expect(all.length).toBe(31 + 65);
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
  });

  it("every caption is short paragraphs with the opening line on its own", () => {
    for (const r of all) {
      const paras = captionParagraphs(r.caption);
      expect(paras.length, r.id).toBeGreaterThanOrEqual(2);
      expect(paras.length, r.id).toBeLessThanOrEqual(4);
      // the opener reads in the two lines the feed shows
      expect(paras[0].length, r.id).toBeLessThanOrEqual(140);
      for (const p of paras) expect(p.length, r.id).toBeLessThanOrEqual(260);
    }
  });

  it("in his voice: no dashes, semicolons, hashtags, emoji runs or engagement bait", () => {
    for (const r of all) {
      expect(r.caption, r.id).not.toMatch(/[—–;]|#\w|\p{Extended_Pictographic}{2,}/u);
      expect(r.caption.toLowerCase(), r.id).not.toMatch(/let me know|drop a|tag a friend|save this|thoughts\?|who else/);
    }
  });

  it("only touches a caption still exactly as it was read, keeps every old one, and never moves a post", () => {
    expect(sql).toContain("WHERE p.id = v.id AND md5(p.caption) = v.old_md5;");
    expect(sql).toContain("WHERE i.id = v.id AND md5(coalesce(i.data->'deck'->>'caption', '')) = v.old_md5;");
    expect(sql).toContain("INSERT INTO public.community_caption_readability_backup");
    expect(sql).not.toMatch(/updated_at\s*=|edited_at\s*=|created_at\s*=/);
    expect(sql).not.toMatch(/community_comments/);
    expect(readFileSync(new URL("../../docs/rollback/2026-11-21-crew-caption-readability-rollback.sql", import.meta.url), "utf8")).toContain("p.caption = b.after");
  });
});
