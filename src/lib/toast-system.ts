import { toast } from "sonner";
import { feedback } from "@/lib/feedback";
import { isRepeat, messageKey, shapeToast, toastFeedback, type ToastKind, type ToastOpts } from "@/lib/toast-policy";

/**
 * Installs the app's confirmation policy on Sonner's `toast` once (the
 * shared object every `import { toast } from "sonner"` sees), so the ~500
 * callers keep their code: one toast at a time (a new one replaces the
 * last), repeats of the same message shown once, short routine timing,
 * routine descriptions dropped, a light haptic, and Undo / errors kept up
 * long enough to act. Rules: toast-policy.ts. Call from the Toaster module.
 */
let installed = false;
let lastKey: { key: string | null; at: number } | null = null;
let currentId: string | number | undefined;

type AnyToast = (message: unknown, opts?: ToastOpts) => string | number;

export function installToastSystem(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const target = toast as unknown as Record<string, AnyToast>;

  const kinds: ToastKind[] = ["success", "info", "message", "warning", "error", "loading"];
  for (const kind of kinds) {
    const original = target[kind]?.bind(toast) as AnyToast | undefined;
    if (!original) continue;
    target[kind] = (message, opts) => {
      const shaped = shapeToast(kind, opts);
      const key = messageKey(kind, message);
      const now = Date.now();
      // A repeat inside the window is the same toast: keep the one showing.
      if (kind !== "loading" && isRepeat(key, lastKey, now) && shaped.id === undefined) {
        lastKey = { key, at: now };
        return currentId ?? "";
      }
      // Replacing a toast by its own id (loading -> success) keeps that id;
      // anything else replaces whatever is showing: no stack.
      if (currentId !== undefined && shaped.id !== currentId) toast.dismiss(currentId);
      const id = original(message, shaped);
      currentId = shaped.id ?? id;
      lastKey = { key, at: now };
      if (kind !== "loading") {
        const ev = toastFeedback(kind);
        if (ev) feedback(ev, { sound: false });
      }
      return id;
    };
  }
}
