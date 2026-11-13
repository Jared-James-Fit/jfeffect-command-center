import { useEffect, useState } from "react";
import { Smartphone } from "lucide-react";
import { phoneOnItsSide, readOrientation } from "@/lib/portrait-only";

/**
 * A phone held on its side, where the browser can't lock it upright (Safari,
 * the iPhone home-screen app): one calm screen over the app asking to turn it
 * back. Nothing underneath changes or reloads, so turning it upright again
 * picks up exactly where they were. The installed app never shows it (iOS
 * keeps it upright).
 */
export function PortraitOnly() {
  const [sideways, setSideways] = useState(false);
  useEffect(() => {
    const check = () => {
      const r = readOrientation();
      setSideways(!!r && phoneOnItsSide(r));
    };
    check();
    const o = typeof screen !== "undefined" ? screen.orientation : undefined;
    o?.addEventListener?.("change", check);
    window.addEventListener("orientationchange", check);
    window.addEventListener("resize", check);
    return () => {
      o?.removeEventListener?.("change", check);
      window.removeEventListener("orientationchange", check);
      window.removeEventListener("resize", check);
    };
  }, []);
  if (!sideways) return null;
  return (
    <div
      role="alert"
      aria-live="polite"
      className="fixed inset-0 z-[2147483646] flex flex-col items-center justify-center gap-3 bg-background px-8 text-center text-foreground"
      data-portrait-only
    >
      <Smartphone className="h-10 w-10 text-muted-foreground" strokeWidth={1.75} aria-hidden />
      <p className="text-[17px] font-semibold">Turn your phone upright</p>
      <p className="max-w-[28ch] text-[14px] leading-snug text-muted-foreground">JF Effect works in portrait. Everything's right where you left it.</p>
    </div>
  );
}
