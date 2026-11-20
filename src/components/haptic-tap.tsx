import { useEffect, useState } from "react";
import { hapticRoute, hapticsEnabled, noteTrustedTick, subscribeHaptics } from "@/platform/haptics";

/**
 * The iPhone's tap under a button, where the web can't vibrate (Safari, the
 * home-screen app, the app's own web view): a see-through label over the
 * button, tied to a hidden `<input type="checkbox" switch>`. The person's own
 * finger lands on the label, the switch flips, and WebKit taps the Taptic
 * Engine, which since iOS 26.5 it does only for a real tap (a scripted one
 * stays quiet). The tap still belongs to the button: the label's click
 * bubbles up to it once (the switch's own click stops at the switch), and
 * pointer events pass through the same way, so holds and double taps work as
 * before. The switch itself is never drawn, so it can never take focus from a
 * box the button opens.
 *
 * Only on an iPhone or iPad with the switch control and with haptics on
 * (everything else gives its tap through feedback()). Put it last inside a
 * `relative` <button type="button">, never a link or a submit button: the
 * label would take their activation.
 */
export function HapticTap() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (hapticRoute() !== "ios") return;
    setOn(hapticsEnabled());
    return subscribeHaptics(setOn);
  }, []);
  if (!on) return null;
  return (
    <label
      aria-hidden
      data-haptic-tap=""
      className="absolute inset-0 z-[1] cursor-[inherit] rounded-[inherit] [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none]"
      // first in the click's path (before the button's own handler calls feedback()),
      // so a scripted tick for the same tap stays quiet on the iPhones that still allow one
      onClick={(e) => {
        if (e.nativeEvent.isTrusted) noteTrustedTick();
      }}
    >
      {/* never drawn, so it can never take focus from a box the button opens (WebKit taps the
          Taptic Engine for a switch it doesn't draw, as the label's own switch) */}
      <input
        type="checkbox"
        {...({ switch: "" } as Record<string, string>)}
        tabIndex={-1}
        aria-hidden
        className="hidden"
        // the label's own click is the button's; this one (the switch flipping) stops here
        onClick={(e) => e.stopPropagation()}
      />
    </label>
  );
}
