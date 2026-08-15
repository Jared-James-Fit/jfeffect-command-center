import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing, CheckCircle2, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  detectPushSupport,
  currentPermission,
  enablePushOnThisDevice,
  hasPushSubscriptionLocally,
  type PushSupport,
} from "@/lib/push/push-client";

type PromptStatus = "loading" | "active" | "inactive" | "blocked" | "unsupported";

export function NotificationSetupPrompt({ className, problemsOnly }: { className?: string; problemsOnly?: boolean }) {
  const [status, setStatus] = useState<PromptStatus>("loading");
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const s = detectPushSupport();
    setSupport(s);
    if (!s.supported) {
      setStatus("unsupported");
      return;
    }
    const p = currentPermission();
    if (p === "denied") {
      setStatus("blocked");
    } else if (p === "granted") {
      hasPushSubscriptionLocally().then((has) => setStatus(has ? "active" : "inactive"));
    } else {
      setStatus("inactive");
    }
  }, []);

  async function onEnable() {
    if (status === "blocked" || status === "unsupported" || status === "loading") return;
    setBusy(true);
    try {
      const result = await enablePushOnThisDevice();
      if (result.ok) {
        setStatus("active");
      } else {
        const p = currentPermission();
        setStatus(p === "denied" ? "blocked" : "inactive");
      }
    } catch {
      setStatus(currentPermission() === "denied" ? "blocked" : "inactive");
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading") return null;
  // Dashboard usage: only take up space when something is actually wrong.
  if (problemsOnly && (status === "active" || status === "unsupported")) return null;

  const active = status === "active";
  const blocked = status === "blocked";
  const unsupported = status === "unsupported";

  const icon = active ? (
    <CheckCircle2 className="h-4 w-4" />
  ) : blocked ? (
    <BellOff className="h-4 w-4" />
  ) : (
    <BellRing className="h-4 w-4" />
  );

  const title = active
    ? "Notifications active"
    : blocked
    ? "Notifications blocked"
    : unsupported
    ? "Notifications not available"
    : "Notifications deactivated";

  const message = active
    ? "You're all set — you'll receive updates on this device."
    : blocked
    ? "Unblock notifications in your browser settings to stay in the loop."
    : unsupported
    ? "Install JF Effect as an app to enable push notifications."
    : "Turn on notifications to get workout reminders and coach messages. Highly recommended.";

  return (
    <Card className={cn("border-border bg-card p-3", className)}>
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-full",
            active ? "bg-emerald-500/15 text-emerald-500" : "bg-primary/10 text-primary",
          )}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-xs leading-snug text-muted-foreground">{message}</div>
        </div>
        {!active && !unsupported && (
          <Button
            size="sm"
            onClick={onEnable}
            disabled={busy || blocked}
            className="h-9 shrink-0 text-xs font-bold"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Enable"}
          </Button>
        )}
      </div>
    </Card>
  );
}
