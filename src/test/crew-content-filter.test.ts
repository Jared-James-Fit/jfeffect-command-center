import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CREW_BLOCK_TERMS,
  CREW_BLOCKED_MESSAGE,
  CREW_FLAG_TERMS,
  collapseRepeats,
  crewFilterTokens,
  crewTextVerdict,
  isCrewFilterError,
  rot13,
} from "@/lib/crew-content-filter";

// Offensive inputs are written ROT13 (letters only; digits and symbols stay)
// so this public repo doesn't spell them out: say("a1tt3e") is the slur in l33t.
const say = (s: string) => rot13(s);
const MIGRATION = "supabase/migrations/20270527109000_crew_ugc_safety.sql";

describe("Crew word filter: what gets refused", () => {
  it.each([
    ["a slur as typed", say("snttbg")],
    ["a slur in l33t", say("a1tt3e")],
    ["a slur with accents", say("avttre").replace("i", "ï")],
    ["a slur stretched", say("snnnnttbg")],
    ["a slur spaced out", say("s n t t b g")],
    ["a slur spaced out with a l33t letter", say("s 4 t t 0 g")],
    ["a slur with a zero-width space inside", say("avt") + "​" + say("tre")],
    ["a slur in a sentence, any case", `What a ${say("ergneq").toUpperCase()} move`],
    ["a threat", say("xvyy lbhefrys")],
    ["a threat in l33t with shouting", say("x1yy l0hef3ys!!!").toUpperCase()],
    ["a threat stretched", say("xvvvvvyy lbhefrys")],
    ["a threat as initials", say("xlf")],
    ["a threat as dotted initials", say("x.l.f")],
    ["a threat with an apostrophe", say("v'yy xvyy lbh")],
    ["sexual solicitation", say("fraq ahqrf")],
  ])("refuses %s", (_label, text) => {
    const v = crewTextVerdict(text);
    expect(v.verdict).toBe("block");
  });

  it("names the category it matched", () => {
    expect(crewTextVerdict(say("snttbg"))).toMatchObject({ verdict: "block", category: "hate" });
    expect(crewTextVerdict(say("xlf"))).toMatchObject({ verdict: "block", category: "violence" });
    expect(crewTextVerdict(say("cbea"))).toMatchObject({ verdict: "block", category: "sexual" });
  });
});

describe("Crew word filter: what goes to the queue", () => {
  it.each([
    ["self-harm", "honestly I want to die after that leg day", "self_harm"],
    ["self-harm (one word)", say("v'z fhvpvqny"), "self_harm"],
    ["an insult with an apostrophe", say("lbh'er htyl"), "harassment"],
    ["an insult spaced", say("sng nff"), "harassment"],
    ["sexual spam", say("baylsnaf yvax va ovb"), "sexual"],
    ["a possible threat", say("v'yy xvyy h"), "violence"],
  ])("flags %s", (_label, text, category) => {
    expect(crewTextVerdict(text)).toMatchObject({ verdict: "flag", category });
  });

  it("blocked beats flagged when both are there", () => {
    expect(crewTextVerdict(`${say("lbh'er htyl")} ${say("xlf")}`).verdict).toBe("block");
  });
});

describe("Crew word filter: what's left alone", () => {
  it.each([
    "Great session today, hit a 140 kg squat PR!",
    "5x5 @ 100kg, RPE 8",
    "The class assessment is on Thursday",
    "Scunthorpe and Penistone are towns",
    "cocktail after the meet? cocky but fair",
    "He sniggered at my warm-up",
    "Niger, Nigeria and Niagara",
    "This finisher kills my legs every time",
    "fucking finally, shit that was heavy",
    "Spicy food and a big bench day",
    "",
    "   ",
    "💪🔥",
  ])("passes %j", (text) => {
    expect(crewTextVerdict(text)).toEqual({ verdict: "ok" });
  });

  it("null and undefined are fine", () => {
    expect(crewTextVerdict(null)).toEqual({ verdict: "ok" });
    expect(crewTextVerdict(undefined)).toEqual({ verdict: "ok" });
  });
});

describe("how the filter reads words", () => {
  it("lower case, accents and l33t letters to plain ones, apostrophes dropped, numbers alone dropped", () => {
    expect(crewFilterTokens("Héllo W0RLD, you're 100% str0ng!")).toEqual(["hello", "world", "youre", "strong"]);
  });
  it("joins letters typed one at a time, and nothing else", () => {
    expect(crewFilterTokens("a b c then d")).toEqual(["abc", "then", "d"]);
  });
  it("folds doubled letters", () => {
    expect(collapseRepeats("kiiilll")).toBe("kil");
  });
  it("rot13 goes both ways", () => {
    expect(rot13(rot13("community rules"))).toBe("community rules");
  });
  it("knows its own refusal", () => {
    expect(isCrewFilterError({ hint: "crew_filter", message: "x" })).toBe(true);
    expect(isCrewFilterError({ message: CREW_BLOCKED_MESSAGE })).toBe(true);
    expect(isCrewFilterError(new Error("Network down"))).toBe(false);
  });
});

describe("the lists", () => {
  const entry = /^(hate|sexual|violence|harassment|self_harm):[a-z]+( [a-z]+)*$/;
  it("every term is category:term, ROT13, lower case letters and single spaces", () => {
    for (const t of [...CREW_BLOCK_TERMS, ...CREW_FLAG_TERMS]) expect(t, t).toMatch(entry);
  });
  it("no term is on both lists, and none is listed twice", () => {
    const words = (l: readonly string[]) => l.map((t) => t.slice(t.indexOf(":") + 1));
    const all = [...words(CREW_BLOCK_TERMS), ...words(CREW_FLAG_TERMS)];
    expect(new Set(all).size).toBe(all.length);
  });

  it("the server's crew_text_verdict holds exactly the same lists (one module, two copies kept in step)", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const arr = (name: string) => {
      const m = sql.match(new RegExp(`${name} constant text\\[\\] := ARRAY\\[([\\s\\S]*?)\\];`));
      expect(m, name).toBeTruthy();
      return [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    };
    expect(arr("v_block")).toEqual([...CREW_BLOCK_TERMS]);
    expect(arr("v_flag")).toEqual([...CREW_FLAG_TERMS]);
  });

  it("the server reads words the same way (same accent, l33t and folding steps)", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(sql).toContain("translate(lower(_text), 'àáâãäåèéêëìíîïòóôõöùúûüýÿñç', 'aaaaaaeeeeiiiiooooouuuuyync')");
    expect(sql).toContain("translate(run, '0134578@$!|', 'oieastbasii')");
    expect(sql).toContain("regexp_split_to_array(s, '[^a-z0-9@$!|]+')");
    expect(sql).toContain("CONTINUE WHEN run !~ '[a-z]' AND NOT (char_length(run) = 1 AND position(run IN '0134578@$!|') > 0);");
    expect(sql).toContain("regexp_replace(run, '^[!|]+|[!|]+$', '', 'g')");
    expect(sql).toContain("regexp_replace(s, '[\\u200B-\\u200D\\uFEFF\\u00AD]', '', 'g')");
    expect(sql).toContain("t ~ '([a-z])\\1\\1'");
  });
});
