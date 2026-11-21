/**
 * Pain history as an AI reads it (pure, tested): the weekly check-in recap,
 * the coach's drafted reply and the training brief all get the same lines and
 * the same rules. The numbers and patterns are worked out in code (history.ts,
 * sessions.ts, recovery.ts); the model only words them.
 */
import { reasonWords, shortDay, sidesLine, type PainArea, type PainHistory } from "@/lib/pain/history";
import { FEELS, TIMINGS, severityLabel } from "@/lib/pain/report";
import { siteAnatomy, siteOf } from "@/lib/pain/sites";
import { associations, associationLine, sessionContext, type PainSession } from "@/lib/pain/sessions";
import { redFlags, URGENT_SIGNS } from "@/lib/pain/safety";
import type { RecoverySuggestion } from "@/lib/pain/recovery";

const feelWord = (f: string) => FEELS.find((x) => x.v === f)?.label.toLowerCase() ?? f;

function quote(s: string, max = 160): string {
  const t = s.replace(/\s+/g, " ").trim();
  return `"${t.length > max ? `${t.slice(0, max - 1)}…` : t}"`;
}

/** One area in plain lines, facts only. */
export function areaLines(a: PainArea, sessions: PainSession[] = []): string[] {
  const head = [
    `${a.label}${sidesLine(a) ? ` (${sidesLine(a)})` : ""}:`,
    a.days === 1 ? `reported once, ${shortDay(a.last)}` : `${a.days} reports since ${shortDay(a.first)}, ${a.recentDays} in the last 6 weeks across ${a.recentWeeks} week${a.recentWeeks === 1 ? "" : "s"}, last ${shortDay(a.last)}`,
    a.latestScore != null ? `latest ${a.latestScore}/10` : a.latestSeverity ? `latest ${severityLabel(a.latestSeverity)!.toLowerCase()}` : null,
    a.status === "quiet" ? "nothing since (gone quiet)" : null,
  ].filter(Boolean).join(" ");
  const lines = [`- ${head}`];
  const facts: string[] = [];
  if (a.trend) facts.push(a.trendFrom === "client" ? `they said it's ${a.trend} than last time (same issue, their word)` : `rated ${a.trend === "worse" ? "worse" : a.trend === "better" ? "milder" : "the same"} than the report before`);
  if (a.sites.length)
    facts.push(
      `where exactly (their tap on the body map, where they feel it, not what's injured): ${a.sites
        .map((x) => `${siteOf(x.site)?.label.toLowerCase() ?? x.site}${siteAnatomy(x.site) ? ` (${siteAnatomy(x.site)!.toLowerCase()})` : ""}${x.count > 1 ? ` ${x.count}×` : ""}`)
        .join(", ")}`,
    );
  if (a.feel.length) facts.push(`feels: ${a.feel.map(feelWord).join(", ")}`);
  if (a.timing.length) facts.push(`hurts: ${a.timing.map((t) => TIMINGS.find((x) => x.v === t)?.label.toLowerCase() ?? t).join(", ")}`);
  if (a.limiting.stopped || a.limiting.modified) facts.push(`in the last 4 weeks it ${[a.limiting.stopped ? `stopped ${a.limiting.stopped} session${a.limiting.stopped > 1 ? "s" : ""}` : null, a.limiting.modified ? `changed ${a.limiting.modified}` : null].filter(Boolean).join(" and ")}`);
  if (a.named.length) facts.push(`exercise they named: ${a.named.map((n) => `${n.name}${n.count > 1 ? ` ${n.count}×` : ""}`).join(", ")}`);
  for (const as of associations(a, sessions)) facts.push(associationLine(as));
  const ctx = sessionContext(a, sessions);
  if (ctx.sessions >= 2 && (ctx.shortSleep >= 2 || ctx.veryHard >= 2 || ctx.lowEnergy >= 2))
    facts.push(`of the ${ctx.sessions} sessions it came up in: ${[ctx.shortSleep ? `${ctx.shortSleep} after under 6h sleep` : null, ctx.veryHard ? `${ctx.veryHard} rated very hard or max` : null, ctx.lowEnergy ? `${ctx.lowEnergy} with low energy going in` : null].filter(Boolean).join(", ")}`);
  if (a.reasons.length) facts.push(`flagged for the coach: ${a.reasons.map(reasonWords).join(", ")}`);
  if (a.entries.some((e) => e.inferred)) facts.push("some places were read from what they typed");
  if (facts.length) lines.push(`  ${facts.join("; ")}`);
  const words = [...a.entries].reverse().filter((e) => e.note).slice(0, 2);
  if (words.length) lines.push(`  their words: ${words.map((e) => `${quote(e.note!)} (${shortDay(e.date)})`).join("; ")}`);
  return lines;
}

/**
 * The PAIN HISTORY block, or null when there's nothing in the window. Quiet
 * areas are listed last and briefly; isolated minor ones are summed up.
 */
export function painHistoryForAi(h: PainHistory, opts: { sessions?: PainSession[]; suggestions?: RecoverySuggestion[] } = {}): string | null {
  const live = h.areas.filter((a) => a.status !== "quiet");
  if (!h.areas.length) return null;
  const lines = ["PAIN HISTORY (what they reported after workouts and in check-ins, last 12 weeks. Their reports, not a diagnosis; two reports are the same issue only where it says they said so):"];
  for (const a of live.filter((x) => !x.minor)) lines.push(...areaLines(a, opts.sessions));
  const minor = live.filter((x) => x.minor);
  if (minor.length) lines.push(`- One-off and mild, nothing to act on: ${minor.map((a) => `${a.label} (${shortDay(a.last)})`).join(", ")}`);
  const quiet = h.areas.filter((a) => a.status === "quiet");
  if (quiet.length) lines.push(`- Gone quiet (nothing in 3+ weeks): ${quiet.map((a) => `${a.label} (last ${shortDay(a.last)})`).join(", ")}`);
  const flags = redFlags(live.flatMap((a) => a.entries));
  if (flags.length) lines.push(`WARNING SIGNS: ${flags.map((f) => `${f.area}: ${f.text}`).join(" ")}`);
  if (opts.suggestions?.length)
    lines.push(
      "RECOVERY OPTIONS (worked out from their history; use at most one or two that fit, never all, and none that isn't here):",
      ...opts.suggestions.map((s) => `- ${s.area ? `${s.area}: ` : ""}${s.title} (${s.why})`),
    );
  return lines.join("\n");
}

export { PAIN_RULES } from "@/lib/pain/rules";

/** Words the coach's drafted reply must never use (it isn't a clinician, and it isn't a wellness app). */
export const DRAFT_BANNED = [
  /\b(diagnos\w*|tendinitis|tendinopathy|tendonitis|bursitis|impingement|strain(ed)?|sprain(ed)?|tear|torn|herniat\w*|sciatica|rotator cuff|labrum|meniscus)\b/i,
  /\b(ibuprofen|advil|naproxen|aleve|tylenol|acetaminophen|anti-?inflammator\w*|ice it|r\.?i\.?c\.?e\.?)\b/i,
  /\b(listen to your body|self-care|wellness journey|be kind to yourself|you've got this|you got this)\b/i,
];

export function draftProblems(text: string): string[] {
  const found: { at: number; word: string }[] = [];
  for (const re of DRAFT_BANNED) for (const m of text.matchAll(new RegExp(re.source, "gi"))) found.push({ at: m.index ?? 0, word: m[0].toLowerCase() });
  return found.sort((a, b) => a.at - b.at).map((f) => f.word);
}

/** The urgent signs, as one line for prompts and the coach's sheet. */
export const URGENT_LINE = `Urgent (get medical help now): ${URGENT_SIGNS.join("; ")}.`;

