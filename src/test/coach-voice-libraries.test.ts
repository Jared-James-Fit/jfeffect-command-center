import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readingGrade, longestSentence, voiceProblems, words } from "@/lib/plain-words";
import { AI_TELLS, DAILY_GRADE_MAX, DAILY_SENTENCE_MAX, GENERIC_PHRASES, SCRIPTED_PHRASES } from "@/lib/daily-visuals";

const sql = readFileSync("supabase/migrations/20270210090000_coach_voice_libraries.sql", "utf8");
const posts = readFileSync("supabase/migrations/20270209090000_coach_voice_posts.sql", "utf8");

const rows = (tag: string) => [...sql.matchAll(new RegExp(`\\('([^']+)', '([0-9a-f]{32})', \\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$\\)`, "g"))].map(([, id, md5, body]) => ({ id, md5, body }));
const tips = rows("t");
const lessons = rows("l");
const holidays = rows("h");
const fixes = [...sql.matchAll(/\['(\w+)', \$o\$([\s\S]*?)\$o\$,\s*\$n\$([\s\S]*?)\$n\$\]/g)].map(([, fn, from, to]) => ({ fn, from, to }));

/** Texting shorthand that drops an apostrophe ("dont", "thats", "lets go"). */
const DROPPED =
  /\b(dont|doesnt|didnt|isnt|arent|wasnt|werent|hasnt|havent|couldnt|wouldnt|shouldnt|cant|wont|youre|youve|youll|theyre|thats|whats|theres|heres|im|ive|hes)\b|\blets go\b|\bits (not|a|the|how|what|your)\b/i;
/** Texting shorthand and hype that read like a motivation page, not a coach. */
const SHORTHAND = /\b(til|vid|gonna|wanna|tho|kinda|yall|lowkey|rn|lol|ngl|tbh|insane|crazy|craa+zy|no guilt)\b/i;
/** The lines the coach banned (Nov 7 2026). */
const BANNED = ["every little bit counts", "give yourself grace", "listen to your body", "movement is medicine", "worse places to spend your time"];

const phrases = (text: string) => {
  const lower = text.toLowerCase();
  return [...GENERIC_PHRASES, ...AI_TELLS, ...SCRIPTED_PHRASES, ...BANNED].filter((p) => lower.includes(p));
};
const problems = (text: string) => [
  ...(DROPPED.test(text) ? [`drops an apostrophe: ${DROPPED.exec(text)![0]}`] : []),
  ...(SHORTHAND.test(text) ? [`shorthand: ${SHORTHAND.exec(text)![0]}`] : []),
  ...phrases(text).map((p) => `says "${p}"`),
  ...voiceProblems(text),
  ...(words(text).length >= 25 && readingGrade(text) > DAILY_GRADE_MAX ? [`grade ${readingGrade(text)}`] : []),
  ...(longestSentence(text) > DAILY_SENTENCE_MAX ? [`a ${longestSentence(text)}-word sentence`] : []),
];
/** Every line opens with a capital, a number, a quote or a bullet's capital (sentence case, Nov 7 2026). */
const sentenceCase = (text: string) =>
  text
    .split("\n")
    .filter((l) => l.trim())
    .filter((l) => !/^(?:•\s*)?["“]?[A-Z0-9]/.test(l.trim()));

describe("Tuesday Tips in the coach's voice", () => {
  it("all 22, each guarded by the text it replaces", () => {
    expect(tips).toHaveLength(22);
    expect(new Set(tips.map((t) => t.id)).size).toBe(22);
    expect(sql).toContain("WHERE i.id = r.id AND md5(i.body) = r.old_md5;");
  });

  it("each reads like a coach: the cue or habit, why, what to do this week", () => {
    expect(tips.flatMap((t) => problems(t.body).map((p) => `${t.id}: ${p}`))).toEqual([]);
    for (const t of tips) {
      expect(sentenceCase(t.body), t.id).toEqual([]);
      expect(words(t.body).length, t.id).toBeGreaterThanOrEqual(40);
      expect(words(t.body).length, t.id).toBeLessThanOrEqual(100);
      // at most one emoji, and these have none
      expect(t.body, t.id).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("keeps every number the tips gave", () => {
    const all = tips.map((t) => t.body).join("\n");
    for (const n of ["3 to 5 minutes", "7 to 9 hours", "1 to 3 hours", "4 to 6 weeks", "2 to 3 seconds", "30 seconds", "80% of the plan", "2 more good reps"]) expect(all, n).toContain(n);
    // a coaching-only ask says who it's for
    expect(all).toContain("For my coaching clients: if everything feels heavy for 2 weeks straight, tell me.");
  });
});

describe("the lesson library in sentence case, the words unchanged", () => {
  it("87 lessons, each guarded by its exact old text", () => {
    expect(lessons).toHaveLength(87);
    expect(new Set(lessons.map((l) => l.id)).size).toBe(87);
  });

  it("every line opens with a capital, and no texting shorthand is left", () => {
    expect(lessons.flatMap((l) => sentenceCase(l.body).map((line) => `${l.id}: ${line}`))).toEqual([]);
    for (const l of lessons) {
      expect(DROPPED.test(l.body), `${l.id}: ${DROPPED.exec(l.body)?.[0]}`).toBe(false);
      expect(/\b(til|vid|gonna|wanna|tho|kinda)\b/i.test(l.body), l.id).toBe(false);
      expect(l.body.length, l.id).toBeLessThanOrEqual(1200);
    }
  });

  it("quotes stay word for word, with no full stop added after a quoted line", () => {
    const ronnie = lessons.find((l) => l.body.includes("Ronnie Coleman"))!;
    expect(ronnie.body.startsWith('"Everybody want to be a bodybuilder, but nobody wants to lift no heavy ass weight"\n')).toBe(true);
    expect(lessons.some((l) => l.body.includes("Ali called himself the greatest"))).toBe(true);
  });
});

describe("holidays in sentence case", () => {
  it("all 10, two short lines each, under the 160-character limit, one emoji at most", () => {
    expect(holidays.map((h) => h.id).sort()).toEqual(["canada_day", "christmas", "easter", "fathers_day", "halloween", "labour_day", "mothers_day", "new_year", "thanksgiving", "valentines"]);
    for (const h of holidays) {
      expect(h.body.length, h.id).toBeLessThanOrEqual(160);
      expect(h.body.split("\n\n"), h.id).toHaveLength(2);
      expect((h.body.match(/\p{Extended_Pictographic}/gu) ?? []).length, h.id).toBeLessThanOrEqual(1);
      expect(sentenceCase(h.body), h.id).toEqual([]);
      expect(problems(h.body), h.id).toEqual([]);
    }
  });
});

describe("the templates in sentence case, no hype", () => {
  it("every piece swapped exactly, so a template that changed stops the migration", () => {
    expect(fixes.length).toBeGreaterThanOrEqual(50);
    expect(sql).toContain("RAISE EXCEPTION 'coach voice: % no longer has %', fn.proname, f[2];");
    // a fix can't contain the piece it replaces, or a second run would apply it twice
    for (const f of fixes) expect(f.to.includes(f.from), f.from.slice(0, 40)).toBe(false);
  });

  it("no hype word in front of the numbers, no 'that's insane', single emojis", () => {
    const to = fixes.map((f) => f.to).join("\n");
    expect(to).not.toMatch(/insane|crazy|craa+zy|🔥🔥🔥|NOT miss/);
    expect(fixes.find((f) => f.from.includes("v_hype_word := lower"))?.to).toContain("no hype word in front of the numbers");
    expect(to).toContain("Not on here yet? Log every set. The app can''t find a PR you didn''t record.");
    // each win line and the intro end with a full stop
    expect(to).toContain("w->>'text') || '.', E'\\n\\n' ORDER BY pos)");
    expect(to).toContain("v_caption := v_intro || '.' || E'\\n\\n' || v_lines");
  });

  it("Wins reads its week through local_to_instant, never a bare AT TIME ZONE", () => {
    const wins = fixes.filter((f) => f.fn === "community_week_wins");
    expect(wins.filter((f) => f.from.includes("AT TIME ZONE tz"))).toHaveLength(4);
    for (const f of wins) expect(f.to).not.toContain("AT TIME ZONE");
  });
});

describe("the live rewrite stays with it", () => {
  it("the coach's two example posts are the daily pictures of Nov 6 and 7", () => {
    expect(posts).toContain("('2026-11-06', '9fb51ff74a', $c$Being in the gym for 3 hours doesn't automatically mean you trained harder.");
    expect(posts).toContain("('2026-11-07', '1484e34c46', $c$Your rest day is part of your program. Not a day you failed to train.");
  });
});
