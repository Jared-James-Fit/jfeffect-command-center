import { useCallback, useRef } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

/**
 * Where a program editor's ← goes. The coach came from somewhere in the app
 * (a client's Training tab, the Program data list, a generated draft, the
 * schedule): back is that place, exactly as it was (its URL, tab and, through
 * the router, its scroll). Only an editor opened cold (a link, a refresh with
 * no history inside the app) falls back to the place it belongs to.
 *
 * Never a link to the client profile: that opened the profile on Summary,
 * whatever tab the coach had been on.
 */
export type EditorBackPlan = { kind: "history" } | { kind: "fallback"; href: string };

export function editorBackPlan(canGoBack: boolean, fallbackHref: string): EditorBackPlan {
  return canGoBack ? { kind: "history" } : { kind: "fallback", href: fallbackHref };
}

/** A client's Training tab: where a block editor belongs when there's no history to go back to. */
export function clientTrainingHref(clientId: string): string {
  return `/admin/clients/${clientId}?tab=training`;
}

/**
 * The editor's back action. `beforeLeave` saves what's on screen first (the
 * editor autosaves, but a pending edit must never be dropped by leaving); if
 * it fails the coach stays put with the error, nothing is lost.
 */
export function useEditorBack(opts: { fallbackHref: string | null; beforeLeave?: () => Promise<void> }) {
  const router = useRouter();
  const navigate = useNavigate();
  const leaving = useRef(false);
  const { fallbackHref, beforeLeave } = opts;
  return useCallback(async () => {
    if (leaving.current) return;
    leaving.current = true;
    try {
      if (beforeLeave) {
        try {
          await beforeLeave();
        } catch (e: any) {
          toast.error(e?.message ? `Couldn't save: ${e.message}` : "Couldn't save your changes, so you're still here.");
          return;
        }
      }
      const plan = editorBackPlan(router.history.canGoBack(), fallbackHref ?? "/admin/clients");
      if (plan.kind === "history") router.history.back();
      else void navigate({ href: plan.href });
    } finally {
      // the page is going: a second tap mid-save is ignored, a failed save frees it
      window.setTimeout(() => { leaving.current = false; }, 400);
    }
  }, [router, navigate, fallbackHref, beforeLeave]);
}
