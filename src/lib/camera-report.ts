import { supabase } from "@/integrations/supabase/client";
import { isNative, nativeAppBuild } from "@/platform";

/**
 * The live camera didn't start in the phone app: record exactly why (error
 * name and message, or a timeout, plus the device and app build) as a support
 * alert, so the cause can be read instead of guessed. Once per camera open,
 * deduped by the database (report_page_error). Best effort, never in the way.
 */
export async function reportCameraTrouble(reason: string, extra: Record<string, unknown> = {}) {
  if (typeof window === "undefined" || !isNative()) return;
  try {
    const build = await nativeAppBuild();
    const md = navigator.mediaDevices as MediaDevices | undefined;
    await (supabase as any).rpc("report_page_error", {
      _route: `${window.location.pathname}#camera`,
      _message: `Live camera didn't start: ${reason}`.slice(0, 300),
      _stack: null,
      _device: {
        ua: navigator.userAgent,
        build,
        mediaDevices: !!md,
        getUserMedia: typeof md?.getUserMedia === "function",
        secure: window.isSecureContext,
        visible: document.visibilityState,
        ...extra,
      },
    });
  } catch {
    /* reporting must never break the camera screen */
  }
}
