import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PLAIN_GRADE_MAX, plainCheck, readingGrade, voiceProblems } from "@/lib/plain-words";

const read = (f: string) => readFileSync(f, "utf8");
const templates = read("supabase/migrations/20270123090000_plain_voice_templates.sql");
const library = read("supabase/migrations/20270123091000_plain_voice_library.sql");

/** The card words a rewrite carries (only what changed). */
type Patch = {
  title?: string;
  where?: string[];
  visual?: { belief?: string; truth?: string; items?: string[] };
  story_q?: string;
  labels?: string[];
};

/** The rewrite rows: id, the md5 it replaces, the new body and its card words. */
const rows = [
  ...library.matchAll(
    /\('([0-9a-f-]{36})'::uuid, '([0-9a-f]{32})', \$l\$([\s\S]*?)\$l\$, \$j\$([\s\S]*?)\$j\$::jsonb\)/g,
  ),
].map(([, id, md5, body, patch]) => ({
  id,
  md5,
  body,
  patch: JSON.parse(patch) as Patch,
}));

describe("the reading check (plain-words.ts)", () => {
  it("flags a textbook paragraph and passes the coach's own texts", () => {
    const dense =
      "A 2022 review of 69 studies on short or no sleep: strength fell about 3% on average, skill tasks about 21%.\n\nA 2018 review found a night with no sleep did little to strength, but short nights in a row can cut force on compound lifts. In a 1994 study, 8 men slept 3 hours a night for 3 nights.\n\nBest read: one short night costs a single a little.";
    const p = plainCheck(dense).problems.join(" | ");
    expect(p).toContain("-word sentence");
    expect(p).toContain("mentions of studies");
    expect(p).toContain('"compound lift"');
    expect(p).toContain('says "best read"');
    // his texts, word for word (My Voice examples)
    expect(
      plainCheck(
        "sheeeesh a 10lb bench PR?? you're cooking 🔥🔥🔥\n\nbar speed on the top set looked massive too so theres more in the tank",
      ).problems,
    ).toEqual([]);
    expect(
      plainCheck(
        "happy thanksgiving yall 🦃 v grateful for every one of you 🙏\n\nbefore you eat today text 1 person who helped you get here. then eat with zero guilt 💪",
      ).problems,
    ).toEqual([]);
  });

  it("scores long words high and a one-liner isn't graded on one long word", () => {
    expect(readingGrade("The cat sat on the mat. It was a warm day.")).toBeLessThan(2);
    expect(
      readingGrade(
        "Exceptional consistency, repeated deliberately, eventually becomes indistinguishable from talent.",
      ),
    ).toBeGreaterThan(PLAIN_GRADE_MAX);
    expect(plainCheck("happy thanksgiving yall 🦃").problems).toEqual([]);
  });

  it("knows what never sounds like him", () => {
    expect(voiceProblems("lets dial in the journey — crucial; fr")).toEqual([
      'says "journey"',
      'says "dial in"',
      'says "crucial"',
      "has a dash",
      "has a semicolon",
      'says "fr"',
    ]);
    expect(voiceProblems("this week lets hit all 4 sessions 💪")).toEqual([]);
  });
});

describe("the library, rewritten plain and in his voice", () => {
  it("rewrites every lesson and the Monday / Friday posts, each guarded by the text it replaces", () => {
    expect(rows.length).toBeGreaterThanOrEqual(103 + 28);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    expect(library).toContain("AND md5(i.body) = r.old_md5;");
    expect(library).toContain(
      "JOIN public.community_series_items i ON i.id = r.id AND md5(i.body) = r.old_md5",
    );
  });

  it("every body passes the reading check, fits a post and starts the way he texts", () => {
    for (const { id, body } of rows) {
      expect(plainCheck(body).problems, `${id}: ${body.slice(0, 60)}`).toEqual([]);
      expect(body.length, id).toBeLessThanOrEqual(1200);
      expect(body, id).not.toMatch(/\*\*|^#|et al|& co\b/m);
    }
    // mostly lowercase: no sentence-case paragraphs left (a paragraph may open with a name, "I", a number or RPE/PR)
    const capped = rows.flatMap((r) =>
      r.body
        .split(/\n\n+/)
        .filter((p) =>
          /^(The|This|That|It|If|You|Your|When|What|Most|A|An|But|And|So|Not|Why|How|Do|Don't|Every|Everyone|Same|One|Two) /.test(
            p,
          ),
        ),
    );
    expect(capped).toEqual([]);
  });

  it("card words stay short and plain, the poll keeps its options", () => {
    for (const { id, patch } of rows) {
      if (patch.title) {
        expect(patch.title.length, id).toBeLessThanOrEqual(48);
        expect(plainCheck(patch.title).problems, id).toEqual([]);
      }
      if (patch.visual?.belief) expect(patch.visual.belief.length, id).toBeLessThanOrEqual(60);
      if (patch.visual?.truth) expect(patch.visual.truth.length, id).toBeLessThanOrEqual(90);
      for (const it of patch.visual?.items ?? []) expect(it.length, id).toBeLessThanOrEqual(40);
      const card = [patch.visual?.belief, patch.visual?.truth, ...(patch.visual?.items ?? [])]
        .filter(Boolean)
        .join("\n");
      if (card) expect(plainCheck(card).problems, id).toEqual([]);
      if (patch.story_q) expect(patch.story_q.length, id).toBeLessThanOrEqual(90);
    }
    // a poll's labels only replace the same number of options, in order, keeping their tags
    expect(library).toContain(
      "AND jsonb_array_length(patch->'labels') = jsonb_array_length(d->'story'->'options')",
    );
    expect(library).toContain("o || jsonb_build_object('label', patch->'labels'->((n - 1)::int))");
  });

  it("posts already out take the new words only while they're still the library's, and keep a Thursday's numbers", () => {
    expect(library).toContain(
      "SET caption = r.body || substr(p.caption, char_length(i.body) + 1),",
    );
    expect(library).toContain("AND substr(p.caption, char_length(i.body) + 1, 3) = E'\\n\\n📊'");
    // a story poll that's out keeps its wording (people answered it)
    expect(library).toContain("pg_temp.plain_merge(p.series_data, r.patch - 'story_q' - 'labels')");
    // Wins already out: only the template's own opening words lose their capital
    expect(library).toContain(
      "'^(Thats|New|Everyone|Ayooooo|Sheeeesh|Noo|Big|Last|Most|Good|Some|Few|Not|Yall|Craaazy|Insane|This|So|Tooo|Wilddd|Holy|Gawd) '",
    );
  });

  it("Thursday points to the screens as they are now", () => {
    const thursday = rows.filter((r) => r.patch.where);
    const where = thursday.map((r) => r.patch.where.join(" › ")).join("\n");
    expect(where).not.toMatch(/^Home › Performance League/m);
    expect(where).not.toMatch(/Community/);
    for (const r of rows)
      expect(r.body, r.id).not.toMatch(/Community tab|Performance League on Home|More → Nutrition/);
  });
});

describe("the post templates read the same way", () => {
  /** Each caption the SQL can write, with sample numbers in place of its fields, joined into one literal. */
  const fill = (sql: string) =>
    sql
      .replace(
        /\((?:v_best|v_c|p\.series_data)->>'(\w+)'\)/g,
        (_m, k: string) =>
          `'${({ a: "5", b: "7", x: "22", y: "11", people: "6" } as Record<string, string>)[k] ?? "3"}'`,
      )
      .replace(/\(_data->>'doers'\)/g, "'log every set in 8 out of 10 workouts or more'")
      .replace(/E'\\n\\n'/g, "'\n\n'")
      .replace(/'\s*\|\|\s*'/g, "");

  it("Tuesday's crew numbers lead with the question and pass the check", () => {
    const body = templates.slice(
      templates.indexOf("v_caption := CASE v_best->>'observation'"),
      templates.indexOf("RETURN v_best || jsonb_build_object('caption', v_caption);"),
    );
    const captions = [...fill(body).matchAll(/(?:WHEN '\w+' THEN|ELSE)\s*'([^']+)'/g)].map(
      (m) => m[1],
    );
    expect(captions).toHaveLength(3);
    expect(captions[0].split("\n")[0]).toBe(
      "do the people who train more hit more PRs? I checked the last 8 weeks 📊",
    );
    for (const c of captions) expect(plainCheck(c).problems, c).toEqual([]);
  });

  it("Thursday's stat line passes the check", () => {
    const body = templates.slice(
      templates.indexOf("RETURN v_c || jsonb_build_object('line'"),
      templates.indexOf("REVOKE ALL ON FUNCTION public.community_feature_stat"),
    );
    const filled = fill(body);
    const lines = [...filled.matchAll(/(?:THEN|ELSE) '([^']+)'/g)].map((m) => m[1]);
    expect(lines).toHaveLength(2);
    const tail = /\|\| '\. ([^']+)'\);/.exec(filled)![1];
    expect(lines[0]).toBe(
      "5 of you log every set in 8 out of 10 workouts or more. those 5 hit about 22 PRs each the last 8 weeks. everyone else: about 11",
    );
    for (const l of lines) expect(plainCheck(`${l}. ${tail}`).problems, l).toEqual([]);
    expect(templates).not.toContain("on average over the last 8 weeks");
  });

  it("Wins stays lowercase every week and a hype word is its own beat", () => {
    expect(templates).not.toContain("upper(left(p, 1))");
    expect(templates).toContain(
      "v_intro := v_hype_word || CASE WHEN v_hype_word ~ '[!?.]$' THEN ' ' ELSE '!! ' END || v_intro;",
    );
    // local times through local_to_instant (Manitoba's fixed UTC-5)
    expect(templates).not.toContain("AT TIME ZONE");
    expect(templates).toContain("public.local_to_instant((_week_start + 10)::timestamp, tz)");
  });

  it("the birthday DM points to Crew", () => {
    expect(templates).not.toContain("in the community");
    expect(templates).toContain("posted a lil something for you on Crew 👀");
  });
});
