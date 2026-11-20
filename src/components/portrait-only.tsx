import { useEffect } from "react";
import { lockPortrait, syncPhoneAttr, unlockPortrait } from "@/lib/portrait-only";
import { CAMERA_OPEN_EVENT, isCameraOpen } from "@/lib/camera/camera-presence";

/**
 * Phones stay upright where the platform allows it, and nothing interrupts
 * where it doesn't (portrait-only.ts). Draws nothing: on mount, and again on
 * coming back (a lock can lapse in the background), it asks the browser to
 * lock portrait (Android's installed web app takes it). Where it's refused
 * the page turns with the phone and keeps the phone layout, so a workout,
 * a form or a chat carries on exactly where it was. Every turn and resize
 * keeps `data-phone` true to the device (a foldable opened or closed). The
 * app's own camera lets the lock go while it's up, so the phone can turn
 * to film (camera-presence.ts).
 */
export function PortraitLock() {
  useEffect(() => {
    const onCamera = () => {
      if (isCameraOpen()) unlockPortrait();
      else void lockPortrait();
    };
    const back = () => {
      if (document.visibilityState === "visible" && !isCameraOpen()) void lockPortrait();
    };
    const sync = () => {
      syncPhoneAttr();
    };
    sync();
    onCamera();
    const o = typeof screen !== "undefined" ? screen.orientation : undefined;
    o?.addEventListener?.("change", sync);
    window.addEventListener("orientationchange", sync);
    window.addEventListener("resize", sync);
    window.addEventListener(CAMERA_OPEN_EVENT, onCamera);
    document.addEventListener("visibilitychange", back);
    return () => {
      o?.removeEventListener?.("change", sync);
      window.removeEventListener("orientationchange", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener(CAMERA_OPEN_EVENT, onCamera);
      document.removeEventListener("visibilitychange", back);
    };
  }, []);
  return null;
}
