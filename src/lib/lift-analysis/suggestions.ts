/**
 * What a read that didn't go ahead by itself keeps for the next open (pure):
 * the ring detection would have used, and the other circles it saw (never
 * drawn: a tap near one snaps to it).
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

/** A ring on Confirm: the plate's centre and semi-axes as shares of the frame. */
export type Ring = { t: number; fx: number; fy: number; fa: number; fb: number };

/**
 * The one ring Confirm opens on (pure). Confirm never offers a choice of
 * circles: it shows its best guess, which a drag or a tap moves. That's the
 * ring detection preselected, else the best circle it saw (circles come
 * best first), sized as a circle in a frame `aspect` (width ÷ height) wide.
 * `fromCircle` says it's only a circle the finder saw, so the caller can
 * snap it to the plate's real rim. Null only when nothing round was seen.
 */
export function oneRing(
  pre: Ring | null,
  circles: { t: number; fx: number; fy: number; fr: number }[],
  aspect: number,
): { ring: Ring; fromCircle: boolean } | null {
  if (pre) return { ring: pre, fromCircle: false };
  const c = circles.find((x) => Number.isFinite(x.fx) && Number.isFinite(x.fy) && x.fr > 0);
  if (!c) return null;
  return {
    ring: { t: c.t, fx: c.fx, fy: c.fy, fa: c.fr, fb: c.fr * (aspect > 0 ? aspect : 9 / 16) },
    fromCircle: true,
  };
}
