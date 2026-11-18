/**
 * Cleo is an AI assistant with no gender (Nov 18 2026): "Cleo", "the AI assistant" or "it", in what
 * Cleo says about itself (the system prompt), the tones a person can pick, the voice instructions,
 * the screens, and the code and comments that describe it. "He" / "him" in Cleo's files is the coach.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { summerSystemPrompt } from "@/lib/summer-context";
import { SUMMER_TONES } from "@/lib/summer-persona";

const GENDERED_SELF = /\b(she|her|hers|herself)\b/i;
const GENDERED_PERSONA = /\b(girl|girly|girls|woman|female|lady)\b|💅/i;

function cleoFiles(): string[] {
  const pick = (dir: string, test: (f: string) => boolean) => readdirSync(dir).filter(test).map((f) => join(dir, f));
  return [
    ...pick("src/lib", (f) => /^(summer|cleo)[\w.-]*\.ts$/.test(f)),
    ...pick("src/components/admin/books", (f) => /^(summer|cleo)[\w.-]*\.tsx$/.test(f)),
    ...pick("src/components/summer", (f) => f.endsWith(".tsx")),
    "src/routes/api/public/hooks/cleo-bench.ts",
    "src/routes/api/public/hooks/summer-voice-check.ts",
  ];
}

describe("Cleo is gender-neutral", () => {
  it("Cleo's own files never call Cleo she or her (a client is \"the client\" there)", () => {
    const files = cleoFiles();
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const hits = readFileSync(f, "utf8").split("\n").map((l, i) => [i + 1, l] as const).filter(([, l]) => GENDERED_SELF.test(l) && !l.includes("never use she/her or he/him for yourself"));
      expect(hits.map(([n, l]) => `${f}:${n}: ${l.trim()}`)).toEqual([]);
    }
  });

  it("the system prompt says who Cleo is once, plainly: an AI assistant, \"it\" when a pronoun is needed, no disclaimers", () => {
    for (const persona of [{}, { owner: false }, { owner: false, finance: true }, { voice: true }]) {
      const p = summerSystemPrompt(persona as any);
      expect(p.match(/IDENTITY: /g)).toHaveLength(1);
      expect(p).toContain('it\'s "Cleo" or "the AI assistant", and "it" if a pronoun is needed');
      expect(p).toContain("Don't bring this up yourself or add AI disclaimers");
    }
  });

  it("no tone gives Cleo a gendered persona; each keeps its personality", () => {
    for (const t of SUMMER_TONES) {
      for (const text of [t.label, t.description, t.greeting, t.prompt]) expect(text, `${t.value}: ${text.slice(0, 60)}`).not.toMatch(GENDERED_PERSONA);
    }
    const hype = SUMMER_TONES.find((t) => t.value === "girly_pop")!;
    expect(hype.label).toBe("Gen Z hype");
    expect(hype.prompt).toMatch(/bubbly, warm, hype energy/i);
  });

  it("the voice instructions and the screens never give Cleo a gender", async () => {
    const { SUMMER_VOICE_STYLE } = await import("@/lib/summer.server");
    expect(SUMMER_VOICE_STYLE).not.toMatch(/female|woman|girl|\bmale\b/i);
    expect(readFileSync("src/components/workouts/program-roadmap.tsx", "utf8")).not.toContain("override hers");
    expect(readFileSync("docs/taxes-and-books.md", "utf8")).not.toMatch(/Cleo is she|she\/her/);
  });
});
