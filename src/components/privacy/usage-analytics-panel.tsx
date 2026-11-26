import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { analyticsOffHere, setAnalyticsOffHere } from "@/lib/app-pulse/pulse-client";
import { optedOut } from "@/lib/app-pulse/pulse-rules";

/**
 * Account → Privacy & data: whether this device shares how the app is used (Business intelligence,
 * Nov 25 2026). On by default. Off is the same as a browser's Global Privacy Control: visits still
 * count toward who's active, but nothing about where they are, where they came from, or how fast
 * and error-free the app was for them is kept, and their browsing is never tied to their account.
 * What's never collected either way is said plainly.
 */
export function UsageAnalyticsPanel() {
  const [off, setOff] = useState(false);
  const [gpc, setGpc] = useState(false);
  useEffect(() => {
    setOff(analyticsOffHere());
    try {
      setGpc(optedOut(navigator as any, window as any));
    } catch {
      setGpc(false);
    }
  }, []);
  const on = !off && !gpc;
  return (
    <div className="space-y-3" id="usage-analytics" data-usage-analytics={on ? "on" : "off"}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[15px] font-medium">Usage analytics on this device</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Which screens you open, roughly where you are (your country and nearest city, from your connection), where
            you came from, and how fast the app ran, so JF Effect can improve. Never what you type, your messages, your
            health or payment details.
          </p>
        </div>
        <Switch
          checked={on}
          disabled={gpc}
          onCheckedChange={(v) => {
            setAnalyticsOffHere(!v);
            setOff(!v);
          }}
          aria-label="Share usage analytics from this device"
        />
      </div>
      {gpc ? (
        <p className="text-[13px] text-muted-foreground">Your browser asks sites not to track (Global Privacy Control), so it's off.</p>
      ) : off ? (
        <p className="text-[13px] text-muted-foreground">Off on this device. Your visits still count toward who's active, nothing more.</p>
      ) : null}
    </div>
  );
}
