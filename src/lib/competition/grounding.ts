/**
 * Cleo's words never carry a number the engines didn't give (pure, tested).
 * Every number in a written section is checked against the numbers in the
 * brief Cleo was handed (the engines' output), with their kg↔lb conversions,
 * small counting numbers and dates allowed. A number that isn't there sends
 * the write-up back once with what was wrong; the coach never sees an
 * invented projection.
 */

const NUM = /(?<![\w.])(\d{1,4}(?:[.,]\d{1,2})?)(?![\d])/g;

/** Every number in a value (deep: strings, numbers, arrays and objects). */
export function numbersIn(v: unknown, out: Set<number> = new Set()): Set<number> {
  if (v == null) return out;
  if (typeof v === "number" && Number.isFinite(v)) {
    out.add(Math.round(v * 100) / 100);
    return out;
  }
  if (typeof v === "string") {
    for (const m of v.matchAll(NUM))
      out.add(Math.round(Number(m[1].replace(",", ".")) * 100) / 100);
    return out;
  }
  if (Array.isArray(v)) {
    for (const x of v) numbersIn(x, out);
    return out;
  }
  if (typeof v === "object")
    for (const x of Object.values(v as Record<string, unknown>)) numbersIn(x, out);
  return out;
}

/** Numbers in `text` that aren't in `allowed` (with conversions and small counts allowed). */
export function ungroundedNumbers(text: string, allowed: Set<number>): number[] {
  const ok = new Set<number>();
  for (const n of allowed) {
    ok.add(n);
    ok.add(Math.round(n * 2.2046226 * 10) / 10);
    ok.add(Math.round(n * 2.2046226));
    ok.add(Math.round(n));
    ok.add(Math.round(n * 10) / 10);
    // shares written as percentages
    if (n > 0 && n < 2) {
      ok.add(Math.round(n * 100));
      ok.add(Math.round(n * 1000) / 10);
    }
  }
  const bad: number[] = [];
  for (const m of String(text ?? "").matchAll(NUM)) {
    const n = Math.round(Number(m[1].replace(",", ".")) * 100) / 100;
    if (n <= 12) continue; // counts, weeks, attempts, RPE
    if (n >= 1900 && n <= 2100) continue; // years
    if (ok.has(n)) continue;
    bad.push(n);
  }
  return [...new Set(bad)];
}

/** Words an assessment must never use with an athlete (and never as a claim to the coach). */
export const NEVER_SAY = [
  /\b\d{1,3}\s?% (chance|probability|likely)\b/i,
  /\bguarantee(d)?\b/i,
  /\b(dehydrat|water load|diuretic|sauna|spit|sodium load|water cut)/i,
];

export function bannedPhrases(text: string): string[] {
  return NEVER_SAY.filter((r) => r.test(text)).map((r) => r.source);
}
