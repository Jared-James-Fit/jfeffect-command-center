import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readingGrade, longestSentence, voiceProblems, words } from "@/lib/plain-words";
import {
  AI_TELLS,
  DAILY_GRADE_MAX,
  DAILY_SENTENCE_MAX,
  GENERIC_PHRASES,
  SCRIPTED_PHRASES,
} from "@/lib/daily-visuals";

const sql = readFileSync("supabase/migrations/20270202090000_automated_posts_new_voice.sql", "utf8");

const series = [
  ...sql.matchAll(/\('(\w+)', (\d+), '([0-9a-f]{10})', \$v\$([\s\S]*?)\$v\$\)/g),
].map(([, name, sort, md5, body]) => ({ name, sort: Number(sort), md5, body }));
const holidays = [...sql.matchAll(/\('(\w+)', '([0-9a-f]{10})', \$h\$([\s\S]*?)\$h\$\)/g)].map(
  ([, key, md5, body]) => ({ key, md5, body }),
);
/** The template pieces: [function, what it was, what it becomes], quotes doubled as in the function's source. */
const fixes = [...sql.matchAll(/\['(\w+)', \$o\$([\s\S]*?)\$o\$,\s*\$n\$([\s\S]*?)\$n\$\]/g)].map(
  ([, fn, from, to]) => ({ fn, from, to }),
);
/** A template piece's words as a post shows them. */
const shown = (piece: string) =>
  [...piece.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'")).join(" ");

/** Texting shorthand that drops an apostrophe ("dont", "thats", "lets go"). */
const DROPPED =
  /\b(dont|doesnt|didnt|isnt|arent|wasnt|werent|hasnt|havent|couldnt|wouldnt|shouldnt|cant|wont|youre|youve|youll|theyre|thats|whats|theres|heres|im|ive)\b|\blets go\b|\bits (not|a|the|how|what|your)\b/i;
/** Slang that reads forced next to his own posts. */
const FORCED = /\b(yall|lowkey|rn|lol|v proud|v grateful|w protein|fr|ngl|tbh)\b/i;

const phrases = (text: string) => {
  const lower = text.toLowerCase();
  return [...GENERIC_PHRASES, ...AI_TELLS, ...SCRIPTED_PHRASES].filter((p) => lower.includes(p));
};

/** Everything that keeps a post from reading like one he'd write himself. */
const problems = (text: string) => [
  ...(DROPPED.test(text) ? [`drops an apostrophe: ${DROPPED.exec(text)![0]}`] : []),
  ...(FORCED.test(text) ? [`forced slang: ${FORCED.exec(text)![0]}`] : []),
  ...phrases(text).map((p) => `says "${p}"`),
  ...voiceProblems(text),
  ...(words(text).length >= 25 && readingGrade(text) > DAILY_GRADE_MAX
    ? [`grade ${readingGrade(text)}`]
    : []),
  ...(longestSentence(text) > DAILY_SENTENCE_MAX ? [`a ${longestSentence(text)}-word sentence`] : []),
];

describe("the library series in his new voice", () => {
  it("rewrites all five series, each guarded by the text it replaces", () => {
    const count = (n: string) => series.filter((s) => s.name === n).length;
    expect(count("monday_motivation")).toBe(14);
    expect(count("finish_strong_friday")).toBe(14);
    expect(count("saturday_spirit")).toBe(10);
    expect(count("try_it_thursday")).toBe(15);
    expect(count("tuesday_tips")).toBe(22);
    expect(new Set(series.map((s) => `${s.name}:${s.sort}`)).size).toBe(series.length);
    expect(sql).toContain("AND left(md5(i.body), 10) = r.old_md5");
  });

  it("every post reads like his own: apostrophes, no slogans or kickers, plain enough for one pass", () => {
    const found = series.flatMap((s) => problems(s.body).map((p) => `${s.name} ${s.sort}: ${p}`));
    expect(found).toEqual([]);
    for (const s of series) {
      expect(s.body.length).toBeLessThanOrEqual(600);
      // a paragraph opens lowercase unless it opens with a name, a number, PR / RPE or a screen
      for (const para of s.body.split(/\n\n+/))
        expect(para, `${s.name} ${s.sort}`).toMatch(
          /^([a-z0-9"]|Kobe|Dorian|Michael|Dave|Coolers|PR|RPE|RDL)/,
        );
    }
  });

  it("keeps every fact and every Thursday path to a screen", () => {
    const all = series.map((s) => s.body).join("\n");
    for (const fact of [
      "Kobe played all 20 of his seasons for one team and won five titles",
      "Kobe scored 81 points in one game in 2006",
      "Dorian Yates won six straight Mr. Olympias doing one or two working sets per exercise",
      "at his own gym in Birmingham",
      "Michael Jordan gave Tim Grover 30 days to prove himself",
      "about fifteen years",
      "the drop goal that won the 2003 World Cup took a second",
      "Coolers, Closers and Cleaners",
    ])
      expect(all).toContain(fact);
    const thursday = series.filter((s) => s.name === "try_it_thursday").map((s) => s.body).join("\n");
    for (const path of [
      "tap Log Weight on the Bodyweight card",
      "tap Add Photos on the Progress card",
      "tap See all analytics",
      "tap Start check-in",
      "tap the trophy on the big Crew button at the bottom for Rankings",
      "in Messages tap +, then Camera or Photos & Videos",
      "tap +250ml, +500ml or +1L",
      "tap the + at the top left of Crew",
      "on the Nutrition tab, tap Open Cookbook",
    ])
      expect(thursday).toContain(path);
  });

  it("says who a coaching-only feature is for, and never tells a story as his own", () => {
    const thursday = series.filter((s) => s.name === "try_it_thursday");
    expect(thursday.find((s) => s.sort === 9)!.body).toMatch(/^for my coaching clients:/);
    expect(thursday.find((s) => s.sort === 12)!.body).toMatch(/^for my coaching clients:/);
    for (const s of series)
      expect(s.body, `${s.name} ${s.sort}`).not.toMatch(
        /\b(i went|i was|i did|my legs|my clients|yesterday i|last week i|when i was)\b/i,
      );
  });

  it("the three Mondays that pointed at a quote the post doesn't carry are written whole", () => {
    const all = series.map((s) => s.body).join("\n");
    expect(all).not.toMatch(/read that twice|notice th(ere|at)'?s nothing in there|that'?s why the best look calm/i);
  });

  it("posts already out take the new words only while they're still the library's", () => {
    expect(sql).toContain("AND starts_with(p.caption, i.body)");
    expect(sql).toContain("AND (p.caption = i.body OR substr(p.caption, char_length(i.body) + 1, 3) = E'\\n\\n📊');");
  });
});

describe("lessons keep their words and get their apostrophes back", () => {
  it("only sure contractions change; a possessive its stays its", () => {
    expect(sql).toContain("['dont', 'don''t']");
    expect(sql).toContain("'\\m([Ll])ets (go|figure)\\M'");
    expect(sql).toContain("'\\m(at|by|on|has|had|near|below|in|of|to) its\\M'");
    // "were", "well", "ill", "id" and "wed" are real words: never touched
    expect(sql).not.toMatch(/\['(were|well|ill|id|wed)',/);
  });

  it("a lesson that's out changes only while it's still the library's, and its story sticker stays", () => {
    expect(sql).toContain("AND p.caption = i.body\n   AND pg_temp.voice_apostrophes(i.body) <> i.body;");
    expect(sql).toContain("AND p.series_data->>'title' = i.data->>'title'");
    expect(sql).not.toMatch(/SET sticker/);
  });
});

describe("holidays in the same voice", () => {
  it("all ten, two short lines each, under the 160 the database allows", () => {
    expect(holidays.map((h) => h.key).sort()).toEqual(
      [
        "canada_day",
        "christmas",
        "easter",
        "fathers_day",
        "halloween",
        "labour_day",
        "mothers_day",
        "new_year",
        "thanksgiving",
        "valentines",
      ].sort(),
    );
    for (const h of holidays) {
      expect([...h.body].length, h.key).toBeLessThanOrEqual(160);
      expect(h.body.split("\n\n"), h.key).toHaveLength(2);
      // superseded by 20270210090000_coach_voice_libraries.sql (sentence case, Nov 7 2026), whose own
      // test holds today's texts to today's phrase lists; these only had to pass the lists of their day
      expect(problems(h.body).filter((p) => !p.includes('"proud of you"')), h.key).toEqual([]);
      expect(h.body, h.key).toBe(h.body.toLowerCase());
    }
  });
});

describe("the templates read the same way", () => {
  it("every piece it rewrites comes out with its apostrophes and no forced slang", () => {
    expect(fixes.length).toBeGreaterThanOrEqual(35);
    for (const f of fixes) {
      expect(f.from, f.fn).not.toBe(f.to);
      const words = shown(f.to);
      expect(DROPPED.test(words), `${f.fn}: ${words}`).toBe(false);
      expect(FORCED.test(words), `${f.fn}: ${words}`).toBe(false);
      expect(phrases(words), `${f.fn}: ${words}`).toEqual([]);
    }
    const fns = new Set(fixes.map((f) => f.fn));
    for (const fn of [
      "community_week_wins",
      "community_compose_wins",
      "community_compose_recap",
      "community_compose_observation",
      "community_feature_stat",
      "community_birthday_compose",
    ])
      expect(fns.has(fn), fn).toBe(true);
  });

  it("a piece that's gone stops the migration instead of being skipped quietly", () => {
    expect(sql).toContain("RAISE EXCEPTION 'automated voice: % no longer has %', fn.proname, f[2];");
    expect(sql).toContain("IF def <> src THEN EXECUTE def; END IF;");
  });
});

describe("Athlete Insights wake up as far ahead as they're made (Nov 9 2026)", () => {
  it("the cron's wake-up window is AHEAD_DAYS, never shorter", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { AHEAD_DAYS } = await import("@/lib/daily-visuals.server");
    const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
    const latest = files.filter((f) => readFileSync(`supabase/migrations/${f}`, "utf8").includes("FUNCTION public.community_daily_visuals_kick")).pop()!;
    expect(readFileSync(`supabase/migrations/${latest}`, "utf8")).toContain(`v_today - 45 AND v_today + ${AHEAD_DAYS}`);
  });
});
