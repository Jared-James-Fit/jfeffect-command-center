/**
 * The longest a session can run, read one way everywhere (pure, tested): the
 * booked PT session they train in when it's the shorter, else Goals & Setup's
 * stated length. The setup recommendation, the previous program's review, the
 * athlete overview and the builder's day estimate all read this, so a session
 * is never "within the limit" on one screen and over it on another.
 */
export type SessionInputs = { goalsMinutes: number | null; ptMinutes?: number | null; observedMedian?: number | null; observedP80?: number | null };

export type SessionLimit = {
  minutes: number | null;
  source: "pt" | "goals" | null;
  pt: number | null;
  stated: number | null;
  /** "their 60-min PT session", "their 75-minute limit (Goals & Setup)" */
  phrase: string;
  /** "60 min · PT session", "75 min · Goals & Setup" */
  short: string;
};

export function sessionLimit(s: SessionInputs): SessionLimit {
  const pt = s.ptMinutes ?? null;
  const stated = s.goalsMinutes ?? null;
  const minutes = pt != null && (stated == null || pt <= stated) ? pt : stated;
  const source: SessionLimit["source"] = minutes == null ? null : minutes === pt ? "pt" : "goals";
  return {
    minutes,
    source,
    pt,
    stated,
    phrase: source === "pt" ? `their ${minutes}-min PT session` : source === "goals" ? `their ${minutes}-minute limit (Goals & Setup)` : "no stated limit",
    short: source === "pt" ? `${minutes} min · PT session` : source === "goals" ? `${minutes} min · Goals & Setup` : "No limit on file",
  };
}

/** Over the limit by more than a few minutes' slack (timers, a long warm-up). */
export function overLimit(minutes: number | null | undefined, limit: number | null | undefined, slack = 5): boolean {
  return minutes != null && limit != null && minutes > limit + slack;
}
