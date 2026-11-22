/**
 * The roadmap's words, written by a model once per revision and checked in
 * code before anyone sees them. The model never decides anything: it gets
 * the engine's read as text (every number already worked out) and writes two
 * short lines in the coach's plain voice, the summary of the plan and the
 * one thing to focus on. Its answer is thrown away (and the engine's own
 * words stay) when it isn't valid JSON, runs long, uses a number the engine
 * didn't give it, or mentions anything the app never plans (dehydration,
 * saunas, diuretics, water or sodium loading, a crash cut). On the OpenAI
 * key (route nutrition_roadmap), never Lovable credits.
 */
import { askRoute } from "@/lib/ai/route-call.server";
import { roadmapText } from "@/lib/nutrition-roadmap/text";
import type { RoadmapRead } from "@/lib/nutrition-roadmap/types";

export type Explanation = { summary: string; focus: string; model: string };

const SYSTEM = `You write two short lines for an athlete about their nutrition roadmap, in a strength coach's plain, direct, conversational voice.
Rules:
- Use ONLY the facts given. Never add a number, date, food, supplement or rule that isn't in them; never recompute anything.
- Never mention dehydration, saunas, diuretics, water loading, sodium loading or crash diets.
- No hype, no slogans, no exclamation marks, no emoji, no "journey", no dashes.
- Honest: if they're behind, say so plainly and constructively; if nothing needs to change, say that.
Reply with JSON only: {"summary": "<one or two sentences, at most 260 characters: what this phase is for and where they stand>", "focus": "<one sentence, at most 140 characters: the one thing to do now>"}`;

const BANNED = /dehydrat|sauna|diuretic|water[- ]?load|sodium[- ]?load|crash diet|water cut|journey|!|—|–/i;

/** Every number in the text, as written ("2,450" → "2450", "0.5"). */
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));
}

/** The model's answer, or null when it can't be trusted. */
export function readExplanation(raw: string, facts: string): { summary: string; focus: string } | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: any;
  try {
    j = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const summary = String(j?.summary ?? "").trim();
  const focus = String(j?.focus ?? "").trim();
  if (!summary || !focus || summary.length > 300 || focus.length > 170) return null;
  if (BANNED.test(summary) || BANNED.test(focus)) return null;
  const allowed = new Set(numbersIn(facts));
  for (const n of numbersIn(`${summary} ${focus}`)) if (!allowed.has(n) && !allowed.has(String(Number(n)))) return null;
  return { summary, focus };
}

/** Write the words for a read; null when no model answered well. */
export async function explainRead(sb: any, read: RoadmapRead, opts: { approved: boolean; firstName: string }): Promise<Explanation | null> {
  const facts = `${roadmapText(read, opts)}\nAthlete: ${opts.firstName}`;
  try {
    const reply = await askRoute("nutrition_roadmap", { system: SYSTEM, prompt: facts, timeoutMs: 30_000 }, { sb });
    const ok = readExplanation(reply.text ?? "", facts);
    return ok ? { ...ok, model: reply.model ?? "unknown" } : null;
  } catch (e) {
    console.warn("[roadmap] explanation unavailable", (e as Error)?.message);
    return null;
  }
}
