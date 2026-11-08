import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { voiceProblems, words } from "@/lib/plain-words";
import { AI_TELLS, EXAMPLE_LINES, GENERIC_PHRASES, SCRIPTED_PHRASES } from "@/lib/daily-visuals";

const sql = readFileSync("supabase/migrations/20270214090000_casual_voice_library.sql", "utf8");
const rows = (tag: string) =>
  [...sql.matchAll(new RegExp(`\\('([^']+)', (?:'([a-z_]+)', )?'([0-9a-f]{32})', \\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$\\)`, "g"))].map(([, id, series, md5, body]) => ({ id, series, md5, body }));
const lessons = rows("l");
const tips = rows("t");
const holidays = rows("h");
const posts = rows("p");
const all = [...lessons, ...tips, ...holidays, ...posts];

const DROPPED = /\b(dont|doesnt|didnt|isnt|arent|wasnt|werent|hasnt|havent|couldnt|wouldnt|shouldnt|cant|wont|youre|youve|youll|theyre|thats|whats|theres|heres|im|ive)\b/i;
const FORMAL = /\b(however|additionally|moreover|furthermore|in conclusion|ultimately|that said)\b/i;
const firstSentence = (t: string) => t.trim().split(/(?<=[.?!])\s|\n/)[0] ?? "";
const INSTRUCTIONS = ["keep going with no rest", "the grind if the rep slows", "let's go, you got this", "you got this\""];
const slogan = (lower: string, x: string) =>
  new RegExp(`(^|[^a-z])${x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(lower) && !INSTRUCTIONS.some((i) => i.includes(x) && lower.includes(i));

describe("the library and the posts under his name, the way he'd type them (Nov 8 2026)", () => {
  it("every unposted lesson, all 22 tips, the 10 holidays and the 42 posts out, each guarded by the text it replaces", () => {
    expect(lessons).toHaveLength(81);
    expect(tips).toHaveLength(22);
    expect(holidays).toHaveLength(10);
    expect(posts).toHaveLength(42);
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
    expect(sql).toContain("WHERE i.id = r.id AND md5(i.body) = r.old_md5;");
    expect(sql).toContain("WHERE h.key = r.key AND md5(h.body) = r.old_md5;");
    expect(sql).toContain("WHERE p.id = r.post_id AND md5(p.caption) = r.old_md5;");
    // a post keeps its date and place in the feed: only the caption changes
    expect(sql).toMatch(/UPDATE public\.community_posts p\n {3}SET caption = r\.caption\n {2}FROM casual_voice_posts r/);
    // his own words aren't touched
    expect(posts.some((p) => p.series === "daily_visual")).toBe(false);
  });

  it("nothing that isn't him: no dashes, semicolons, formal transitions, AI tells, slogans, dropped apostrophes or his example's lines", () => {
    const bad = all.flatMap((r) => {
      const lower = r.body.toLowerCase();
      return [
        ...voiceProblems(r.body),
        ...(DROPPED.test(r.body) ? [`dropped apostrophe: ${DROPPED.exec(r.body)![0]}`] : []),
        ...(FORMAL.test(r.body) ? [`formal: ${FORMAL.exec(r.body)![0]}`] : []),
        ...[...AI_TELLS, ...SCRIPTED_PHRASES].filter((x) => lower.includes(x)).map((x) => `says "${x}"`),
        // whole phrases used as slogans only: "grindy reps", "keep going with no rest" (a drop set) and
        // "the grind if the rep slows down" (meet-day visualising) are instructions, and the Ali lesson
        // quotes "you got this" as the hype self-talk it's about
        ...GENERIC_PHRASES.filter((x) => slogan(lower, x)).map((x) => `says "${x}"`),
        ...EXAMPLE_LINES.filter((x) => lower.includes(x)).map((x) => `borrows "${x}"`),
        ...(/#\w|@\w/.test(r.body) ? ["hashtag or tag"] : []),
        ...((r.body.match(/\p{Extended_Pictographic}/gu) ?? []).length > 1 ? ["more than one emoji"] : []),
      ].map((p) => `${r.id}: ${p}`);
    });
    expect(bad).toEqual([]);
  });

  it("each kind keeps its limits", () => {
    for (const l of lessons) expect(l.body.length, l.id).toBeLessThanOrEqual(1200);
    for (const t of tips) {
      expect(words(t.body).length, t.id).toBeGreaterThanOrEqual(25);
      expect(words(t.body).length, t.id).toBeLessThanOrEqual(100);
    }
    for (const h of holidays) {
      expect(h.body.length, h.id).toBeLessThanOrEqual(160);
      expect(h.body.split("\n\n"), h.id).toHaveLength(2);
    }
    // a coaching-only ask still says who it's for
    expect(tips.some((t) => /for my coaching clients/i.test(t.body))).toBe(true);
  });

  it("varied, never one template: some lowercase, few question hooks, his habits only now and then", () => {
    const shareLower = all.filter((r) => /^[a-z]/.test(r.body.trim())).length / all.length;
    expect(shareLower).toBeGreaterThan(0.2);
    expect(shareLower).toBeLessThan(0.6);
    const questionHooks = [...lessons, ...tips].filter((r) => firstSentence(r.body).includes("?")).length;
    expect(questionHooks / (lessons.length + tips.length)).toBeLessThan(0.25);
    const lol = all.filter((r) => /\blol\b/i.test(r.body)).length;
    expect(lol / all.length).toBeLessThan(0.12);
    for (const r of all) expect((r.body.match(/\blol\b/gi) ?? []).length, r.id).toBeLessThanOrEqual(1);
    // bullets only where a list reads better
    expect(lessons.filter((l) => l.body.includes("•")).length).toBeLessThan(12);
  });

  it("quotes and studies stay word for word", () => {
    const text = all.map((r) => r.body).join("\n");
    expect(text).toContain("Everybody want to be a bodybuilder, but nobody wants to lift no heavy ass weight");
    expect(text).toMatch(/a 2017 study found/i);
    expect(text).toContain("Barry Manilow");
  });
});
