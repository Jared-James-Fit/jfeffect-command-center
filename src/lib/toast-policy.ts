/**
 * The app's one confirmation (toast) policy, pure so it's tested
 * (toast-policy.test.ts). toast-system.ts applies it to Sonner in one place,
 * so every `toast.success(...)` in the app (coach and client) gets the same
 * short pill, the same timing and no stacking without editing each caller.
 */

export type ToastKind = "success" | "info" | "message" | "warning" | "error" | "loading";

/** A routine confirmation: seen for ~1.8 s, then gone. */
export const ROUTINE_MS = 1800;
/** Something to act on (Undo, Open, Retry) stays long enough to tap. */
export const ACTION_MIN_MS = 6000;
/** Errors and warnings stay long enough to read. */
export const PROBLEM_MIN_MS = 4500;
/** The same message inside this window is one toast, not a repeat. */
export const DEDUPE_MS = 1500;

export type ToastOpts = {
  description?: unknown;
  duration?: number;
  action?: unknown;
  cancel?: unknown;
  id?: string | number;
  [key: string]: unknown;
};

export type ShapedOpts = ToastOpts & { duration: number };

/** Only plain text messages can be compared, deduped or kept short. */
export function messageKey(kind: ToastKind, message: unknown): string | null {
  return typeof message === "string" && message.trim() ? `${kind}:${message.trim().toLowerCase()}` : null;
}

export function hasAction(opts: ToastOpts | undefined): boolean {
  return !!opts && (!!opts.action || !!opts.cancel);
}

/**
 * Routine success / info / message toasts lose their second line (the title
 * says it) and time out quickly; actionable ones stay for ACTION_MIN_MS;
 * errors and warnings keep their description (it's the "why") and stay
 * PROBLEM_MIN_MS. A caller's longer duration (Infinity included) is kept.
 */
export function shapeToast(kind: ToastKind, opts: ToastOpts = {}): ShapedOpts {
  const out: ToastOpts = { ...opts };
  const asked = typeof opts.duration === "number" ? opts.duration : undefined;
  let duration: number;
  if (kind === "loading") {
    duration = asked ?? Infinity;
  } else if (hasAction(opts)) {
    duration = Math.max(asked ?? 0, ACTION_MIN_MS);
  } else if (kind === "error" || kind === "warning") {
    duration = Math.max(asked ?? 0, PROBLEM_MIN_MS);
  } else {
    duration = asked !== undefined ? Math.min(asked, 3000) : ROUTINE_MS;
    delete out.description;
  }
  return { ...out, duration };
}

/** True when this message is a repeat of the last one, so it's shown once. */
export function isRepeat(
  key: string | null,
  last: { key: string | null; at: number } | null,
  now: number,
): boolean {
  return !!key && !!last && last.key === key && now - last.at < DEDUPE_MS;
}

/** Which haptic a toast gets: none for loading / info, light for success, error for problems. */
export function toastFeedback(kind: ToastKind): "complete" | "warning" | "error" | null {
  if (kind === "success") return "complete";
  if (kind === "warning") return "warning";
  if (kind === "error") return "error";
  return null;
}

/**
 * Whether a toast's feedback is heard as well as felt: only a failure (the
 * soft low warning, feedback.ts), since a success already has its pill and
 * a heads-up its haptic. The sound's own spacing keeps a run of errors to one.
 */
export function toastSound(kind: ToastKind): boolean {
  return kind === "error";
}
