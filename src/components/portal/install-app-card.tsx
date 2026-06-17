import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Smartphone, CheckCircle2, ChevronRight } from "lucide-react";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { InstallAppDialog } from "./install-app-dialog";
import { cn } from "@/lib/utils";

/**
 * Permanent client-dashboard action: "Install JF Effect on Your Phone".
 * Always present, full-width tappable card. Opens platform-aware modal.
 * In standalone (installed) mode, shows "JF Effect Installed" state.
 */
export function InstallAppCard({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const info = usePwaInstall();
  const installed = info.isStandalone;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("block w-full text-left", className)}
        aria-label={installed ? "JF Effect Installed" : "Install JF Effect on Your Phone"}
      >
        <Card
          className={cn(
            "flex items-center gap-3 p-4 transition active:scale-[0.99]",
            installed
              ? "border-success/40 bg-success/5 hover:border-success"
              : "border-primary/30 bg-gradient-to-br from-primary/10 to-card hover:border-primary",
          )}
        >
          <div
            className={cn(
              "grid h-11 w-11 shrink-0 place-items-center rounded-xl shadow-sm",
              installed
                ? "bg-success/15 text-success"
                : "bg-gradient-primary text-primary-foreground",
            )}
          >
            {installed ? <CheckCircle2 className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold">
              {installed ? "JF Effect Installed" : "Install JF Effect on Your Phone"}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {installed
                ? "Tap for tips on opening it from your home screen."
                : "One tap — get the app icon on your home screen."}
            </div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Card>
      </button>
      <InstallAppDialog open={open} onOpenChange={setOpen} />
    </>
  );
}