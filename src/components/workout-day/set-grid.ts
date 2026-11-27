/**
 * The set table's columns, shared by its header, every set row and the
 * warm-up rows so they always line up. Pure (tested).
 *
 *   number (the done button) · reps · timer · distance · calories · RPE/RIR · velocity · weight · video
 *
 * There is no status column: the set number is the done button. The video
 * column is a coaching client's only (a set filmed for the coach).
 */
export type SetGridColumns = {
  focusMode?: boolean;
  showReps: boolean;
  showTimer: boolean;
  /** Cardio time has an editable value and compact timer control. */
  cardioTime?: boolean;
  /** a run's distance (km / mi); optional, so older callers leave it off */
  showDistance?: boolean;
  showCalories: boolean;
  showVelocity: boolean;
  hideWeight: boolean;
  videoColumn: boolean;
};

export function setGridTemplate(c: SetGridColumns): string {
  return [
    c.focusMode ? "40px" : "34px",
    c.showReps ? "1fr" : null,
    c.showTimer ? (c.cardioTime ? "minmax(0, 1.6fr)" : "1fr") : null,
    c.showDistance ? "1fr" : null,
    c.showCalories ? "1fr" : null,
    c.showVelocity ? "minmax(56px, 1fr)" : null,
    "1fr",
    !c.hideWeight ? "1.35fr" : null,
    c.videoColumn ? (c.focusMode ? "36px" : "30px") : null,
  ]
    .filter(Boolean)
    .join(" ");
}
