import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { SlowLoadHint } from "@/components/slow-load-hint";

const ROTATING_MESSAGES = [
  "Checking your account…",
  "Loading workouts…",
  "Loading nutrition…",
  "Almost ready…",
];

type Props = {
  title?: string;
  onRetry?: () => void;
};

/**
 * Branded first-load splash for the authenticated app.
 *
 * - Renders instantly with JF Effect branding.
 * - Rotates short status messages every 1.8s.
 * - After 4s says a first open can take up to a minute (CSS-timed, so it shows
 *   even before the app's JavaScript has loaded, opened from a text link).
 * - After 30s offers Retry, late enough not to restart a load that's working.
 */
export function DashboardSplash({ title = "Loading your dashboard…", onRetry }: Props) {
  const [messageIndex, setMessageIndex] = useState(0);
  const [verySlow, setVerySlow] = useState(false);

  useEffect(() => {
    const rotate = window.setInterval(() => {
      setMessageIndex((i) => (i + 1) % ROTATING_MESSAGES.length);
    }, 1800);
    const verySlowT = window.setTimeout(() => setVerySlow(true), 30000);
    return () => {
      window.clearInterval(rotate);
      window.clearTimeout(verySlowT);
    };
  }, []);

  const handleRetry = () => {
    if (onRetry) {
      onRetry();
      return;
    }
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  return (
    <main className="relative grid min-h-[100dvh] place-items-center overflow-hidden bg-background px-6 text-foreground">
      <div className="pointer-events-none absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-primary/8 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-40 -left-40 h-[500px] w-[500px] rounded-full bg-primary/5 blur-[120px]" />

      <div className="relative flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <img
          src="/logo.png"
          alt="JF Effect"
          className="h-20 w-20 rounded-2xl shadow-glow animate-pulse"
        />

        <div className="flex flex-col items-center gap-2">
          <span className="text-sm font-black tracking-[0.24em] uppercase">JF Effect</span>
          <h1 className="text-base font-semibold text-foreground">{title}</h1>
        </div>

        <div className="flex min-h-[1.25rem] items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span
            key={messageIndex}
            className="animate-in fade-in duration-500"
          >
            {ROTATING_MESSAGES[messageIndex]}
          </span>
        </div>

        {!verySlow ? (
          <SlowLoadHint className="rounded-full border border-border/60 bg-muted/40 px-3 py-1.5 text-[11px]" />
        ) : null}

        {verySlow ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-border/60 bg-card/60 px-4 py-4 backdrop-blur">
            <p className="text-xs text-muted-foreground">
              Still not open? Try again.
            </p>
            <Button size="sm" variant="secondary" onClick={handleRetry} className="gap-2">
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </Button>
          </div>
        ) : null}
      </div>
    </main>
  );
}