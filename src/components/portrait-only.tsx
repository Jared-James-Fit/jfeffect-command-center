import { useEffect } from "react";
import { lockPortrait, syncPhoneAttr, unlockPortrait } from "@/lib/portrait-only";
import { CAMERA_OPEN_EVENT, isCameraOpen } from "@/lib/camera/camera-presence";
import { onRotationSettle } from "@/lib/rotation-settle";

/**
 * Phones stay upright where the platform allows it, and nothing interrupts
 * where it doesn't (portrait-only.ts). Draws nothing: on mount, and again on
 * coming back (a lock can lapse in the background), it asks the browser to
 * lock portrait (Android's installed web app takes it). Where it's refused
 * the page turns with the phone and keeps the phone layout, so a workout,
 * a form or a chat carries on exactly where it was. Every turn and resize
 * keeps `data-phone` true to the device (a foldable opened or closed), read
 * again as a turn settles (rotation-settle.ts). The app's own camera lets
 * the lock go while it's up, so the phone can turn to film
 * (camera-presence.ts), and so does a video played full screen (a 16:9 clip
 * turned on its side, Instagram's), the lock coming back when it ends.
 */
export function PortraitLock() {
  useEffect(() => {
    const free = () => isCameraOpen() || fullscreenNow();
    const onCamera = () => {
      if (free()) unlockPortrait();
      else void lockPortrait();
    };
    const back = () => {
      if (document.visibilityState === "visible" && !free()) void lockPortrait();
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
    document.addEventListener("fullscreenchange", onCamera);
    document.addEventListener("webkitfullscreenchange", onCamera);
    document.addEventListener("visibilitychange", back);
    const stopSettle = onRotationSettle(sync);
    return () => {
      stopSettle();
      document.removeEventListener("fullscreenchange", onCamera);
      document.removeEventListener("webkitfullscreenchange", onCamera);
      o?.removeEventListener?.("change", sync);
      window.removeEventListener("orientationchange", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener(CAMERA_OPEN_EVENT, onCamera);
      document.removeEventListener("visibilitychange", back);
    };
  }, []);
  return null;
}

/** Something (a video) is full screen: the phone may turn for it. */
function fullscreenNow(): boolean {
  const d = document as Document & { webkitFullscreenElement?: Element | null };
  return !!(d.fullscreenElement ?? d.webkitFullscreenElement);
}
