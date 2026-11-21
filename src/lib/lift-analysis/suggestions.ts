/**
 * What a read that didn't go ahead by itself keeps for the next open (pure):
 * the ring detection would have used, and the other circles worth offering.
 */
/**
 * A circle worth offering on Confirm (shares of the frame). The one detection
 * would preselect carries its own size (`fa` / `fb`) and `preselect`.
 */
export type Suggestion = {
  t: number;
  fx: number;
  fy: number;
  fr: number;
  fa?: number;
  fb?: number;
  preselect?: boolean;
};

/** The marker detection would preselect, from a stored "needs a look" row. */
export function preselectOf(
  suggestions: Suggestion[] | null | undefined,
): { t: number; fx: number; fy: number; fa: number; fb: number } | null {
  const s = (suggestions ?? []).find((x) => x.preselect && x.fa != null && x.fb != null);
  return s ? { t: s.t, fx: s.fx, fy: s.fy, fa: s.fa!, fb: s.fb! } : null;
}

/** What to keep from a proposal for the next open: the preselected ring first, then the other circles. */
export function proposalSuggestions(
  p: {
    key: { t: number; fx: number; fy: number; fa: number; fb: number } | null;
    candidates: { t: number; fx: number; fy: number; fr: number }[];
  } | null,
): Suggestion[] {
  if (!p) return [];
  const pre: Suggestion[] = p.key
    ? [
        {
          t: p.key.t,
          fx: p.key.fx,
          fy: p.key.fy,
          fr: p.key.fa,
          fa: p.key.fa,
          fb: p.key.fb,
          preselect: true,
        },
      ]
    : [];
  return [...pre, ...p.candidates.slice(0, 6)];
}
