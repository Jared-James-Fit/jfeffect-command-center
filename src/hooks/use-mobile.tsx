import * as React from "react";
import { onPhoneLayoutChange, phoneLayoutNow } from "@/lib/portrait-only";

/**
 * The phone layout: under md (768px), or a phone in any orientation. A phone
 * turned on its side is 852pt wide but keeps the phone layout, so a screen
 * that chooses in JS never swaps its tree (and loses what's typed or open)
 * when the phone turns (portrait-only.ts, the same rule as Tailwind's md).
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const onChange = () => setIsMobile(phoneLayoutNow());
    onChange();
    return onPhoneLayoutChange(onChange);
  }, []);

  return !!isMobile;
}

/**
 * Same rule as useIsMobile, but read during the first render (client
 * pages only, e.g. under /_authenticated, which is `ssr: false`), so a screen
 * that lays itself out differently on a phone never paints the desktop
 * layout first and then jumps.
 */
export function useIsMobileNow() {
  const [isMobile, setIsMobile] = React.useState(() => phoneLayoutNow());
  React.useEffect(() => {
    const onChange = () => setIsMobile(phoneLayoutNow());
    onChange();
    return onPhoneLayoutChange(onChange);
  }, []);
  return isMobile;
}
