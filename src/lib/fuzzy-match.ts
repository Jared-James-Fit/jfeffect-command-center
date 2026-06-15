/**
 * Tiny fuzzy matcher with scoring + highlight ranges.
 * No external deps. Good enough for command-palette filtering of a few
 * hundred items per keystroke.
 */

export type FuzzyMatch = {
  score: number; // higher = better; 0 means no match
  ranges: Array<[number, number]>; // [start, endExclusive] highlight ranges in the haystack
};

/**
 * Subsequence scorer. Awards bonuses for:
 *  - Consecutive matches (tight runs)
 *  - Word-boundary matches (start of word, after space/-/_/.)
 *  - Prefix matches (start of haystack)
 *  - Exact substring of the full needle
 *
 * Penalises gaps and unmatched leading characters.
 */
export function fuzzyMatch(haystack: string, needle: string): FuzzyMatch {
  if (!needle) return { score: 0, ranges: [] };
  const hay = haystack.toLowerCase();
  const ndl = needle.toLowerCase().trim();
  if (!ndl) return { score: 0, ranges: [] };

  // Direct substring fast path — strongest possible signal.
  const direct = hay.indexOf(ndl);
  if (direct >= 0) {
    let score = 1000 - direct * 2 + ndl.length * 4;
    if (direct === 0) score += 200; // prefix bonus
    // Word-boundary bonus
    if (direct > 0) {
      const prev = hay[direct - 1];
      if (prev === " " || prev === "-" || prev === "_" || prev === "/" || prev === ".") {
        score += 80;
      }
    }
    return { score, ranges: [[direct, direct + ndl.length]] };
  }

  // Subsequence scoring
  const ranges: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  let score = 0;
  let lastMatchIdx = -2;
  let runStart = -1;
  let firstMatchIdx = -1;

  while (i < hay.length && j < ndl.length) {
    if (hay[i] === ndl[j]) {
      if (firstMatchIdx < 0) firstMatchIdx = i;
      let bonus = 1;
      if (i === lastMatchIdx + 1) bonus += 6; // consecutive
      const prev = i > 0 ? hay[i - 1] : "";
      if (i === 0 || prev === " " || prev === "-" || prev === "_" || prev === "/" || prev === ".") {
        bonus += 12; // word boundary
      }
      score += bonus;
      // Track contiguous run for highlight ranges
      if (i === lastMatchIdx + 1 && runStart >= 0) {
        // extend current range
        ranges[ranges.length - 1][1] = i + 1;
      } else {
        ranges.push([i, i + 1]);
        runStart = i;
      }
      lastMatchIdx = i;
      j++;
    }
    i++;
  }

  if (j < ndl.length) return { score: 0, ranges: [] };
  // Penalise unmatched leading chars and overall length
  if (firstMatchIdx > 0) score -= Math.min(firstMatchIdx, 20);
  score -= Math.max(0, hay.length - ndl.length) * 0.05;
  return { score: Math.max(1, Math.round(score)), ranges };
}

/** Try multiple haystacks; keep the best match. */
export function bestFuzzy(
  needle: string,
  haystacks: Array<string | null | undefined>,
): { score: number; ranges: Array<[number, number]>; haystackIdx: number } {
  let best = { score: 0, ranges: [] as Array<[number, number]>, haystackIdx: -1 };
  for (let i = 0; i < haystacks.length; i++) {
    const h = haystacks[i];
    if (!h) continue;
    const m = fuzzyMatch(h, needle);
    if (m.score > best.score) {
      best = { score: m.score, ranges: m.ranges, haystackIdx: i };
    }
  }
  return best;
}

/** Split a string into segments tagged with whether they are highlighted. */
export function highlightSegments(text: string, ranges: Array<[number, number]>) {
  if (!ranges.length) return [{ text, hit: false }];
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Array<{ text: string; hit: boolean }> = [];
  let cursor = 0;
  for (const [s, e] of sorted) {
    if (s > cursor) out.push({ text: text.slice(cursor, s), hit: false });
    out.push({ text: text.slice(s, e), hit: true });
    cursor = e;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), hit: false });
  return out;
}