/**
 * What "Send" does with the coach's instructions on Program Intelligence
 * (Tell Cleo what you want), at each point of a run. Pure, tested
 * (program-intel-direction-send.test.ts).
 *
 * Instructions only ever reach Cleo inside a run (the setup's coach notes are
 * read when a strategy or a program is written), so Send starts the run that
 * uses them: nothing running → Cleo writes the strategy for the coach to check;
 * a strategy or a draft waiting that was written before these words → a new
 * one written with them (the old draft is kept under Earlier programs); a run
 * that stopped → start again with them. While Cleo is writing, nothing is sent
 * (one run at a time per client) and the card says the words go with the next.
 */

export type DirectionStage =
  | "setup"
  | "strategy_running"
  | "strategy_ready"
  | "strategy_error"
  | "building"
  | "draft_ready"
  | "draft_error";

export type DirectionAction = "strategy" | "rewrite" | "rebuild" | "restart";

export type DirectionSend = {
  /** What tapping Send does; null = nothing to send right now (the hint says why). */
  action: DirectionAction | null;
  label: string;
  hint: string;
};

/** Two sets of instructions say the same thing: spaces and line breaks don't count. */
export function sameInstructions(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
}

/**
 * notes: what's in the box now. used: the instructions the run on screen was
 * started with (null when there's no run). blocked: a setup conflict that stops
 * a run. cleo: the coach has Cleo (the words name it only then).
 */
export function directionSend(x: {
  stage: DirectionStage;
  notes: string;
  used: string | null;
  blocked: boolean;
  cleo: boolean;
}): DirectionSend | null {
  if (!x.notes.trim()) return null;
  const same = x.used != null && sameInstructions(x.notes, x.used);
  switch (x.stage) {
    case "setup":
      if (x.blocked)
        return {
          action: null,
          label: "",
          hint: "Fix the conflicts in the setup first, then send these.",
        };
      return {
        action: "strategy",
        label: x.cleo ? "Send to Cleo" : "Write the strategy",
        hint: x.cleo
          ? "Cleo writes the strategy from these for you to check before anything's built."
          : "The strategy is written from these for you to check before anything's built.",
      };
    case "strategy_running":
    case "building":
      return {
        action: null,
        label: "",
        hint: same
          ? x.stage === "building"
            ? "The program is being built from these."
            : "The strategy is being written from these."
          : "A run is going. Send these once it's done: they weren't in it.",
      };
    case "strategy_ready":
      if (same) return { action: null, label: "", hint: "The strategy below follows these." };
      if (x.blocked)
        return {
          action: null,
          label: "",
          hint: "The strategy below was written before these. Fix the conflicts in the setup first, then send them.",
        };
      return {
        action: "rewrite",
        label: "Rewrite the strategy with these",
        hint: "The strategy below was written before these changes.",
      };
    case "draft_ready":
      if (same) return { action: null, label: "", hint: "The draft below was built from these." };
      if (x.blocked)
        return {
          action: null,
          label: "",
          hint: "The draft below was built before these. Fix the conflicts in the setup first, then send them.",
        };
      return {
        action: "rebuild",
        label: "Build a new draft with these",
        hint: "The draft below was built before these changes. It stays under Earlier programs.",
      };
    case "strategy_error":
    case "draft_error":
      if (same)
        return { action: null, label: "", hint: "The last run stopped: try it again below." };
      if (x.blocked)
        return {
          action: null,
          label: "",
          hint: "Fix the conflicts in the setup first, then send these.",
        };
      return {
        action: "restart",
        label: "Start over with these",
        hint: "The last run stopped before these changes.",
      };
  }
}

/** The instructions a run was started with (its setup's coach notes). */
export function runInstructions(job: { options?: unknown } | null | undefined): string | null {
  if (!job) return null;
  const notes = (job.options as { setup?: { coachNotes?: unknown } } | null | undefined)?.setup
    ?.coachNotes;
  return typeof notes === "string" ? notes : "";
}
