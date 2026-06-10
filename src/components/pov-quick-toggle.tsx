import { useState } from "react";
import { useNavigate, useLocation } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { setPovPersona } from "@/lib/pov.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Eye, Shield, User, ArrowRightLeft } from "lucide-react";
import { cn } from "@/lib/utils";

const POV_FLAG_KEY = "jf-pov-active";
const POV_PERSONA_KEY = "jf-pov-persona";

export function setPovFlag(persona: string | null) {
  try {
    if (persona) {
      localStorage.setItem(POV_FLAG_KEY, "1");
      localStorage.setItem(POV_PERSONA_KEY, persona);
    } else {
      localStorage.removeItem(POV_FLAG_KEY);
      localStorage.removeItem(POV_PERSONA_KEY);
    }
  } catch {}
}

export function getPovFlag(): { active: boolean; persona: string | null } {
  try {
    return {
      active: localStorage.getItem(POV_FLAG_KEY) === "1",
      persona: localStorage.getItem(POV_PERSONA_KEY),
    };
  } catch {
    return { active: false, persona: null };
  }
}

/**
 * Fast toggle between Admin/Coach view and Member POV.
 * Shows as a segmented pill at the top of the page.
 */
export function PovQuickToggle({
  className,
  variant = "banner",
}: {
  className?: string;
  variant?: "banner" | "floating";
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const setPersona = useServerFn(setPovPersona);
  const [busy, setBusy] = useState(false);
  const pov = getPovFlag();
  const isMemberView = pov.active || location.pathname.startsWith("/m");

  const goAdmin = async () => {
    if (busy) return;
    setBusy(true);
    try {
      setPovFlag(null);
      await qc.invalidateQueries({ queryKey: ["m-me"] });
      toast.success("Back to Admin");
      navigate({ to: "/admin" });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to switch");
    } finally {
      setBusy(false);
    }
  };

  const goMember = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await setPersona({ data: { persona: "app_member" } as any });
      setPovFlag("app_member");
      await qc.invalidateQueries({ queryKey: ["m-me"] });
      toast.success("Switched to Member view");
      navigate({ to: "/m" });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to switch");
    } finally {
      setBusy(false);
    }
  };

  if (variant === "floating") {
    return (
      <div
        className={cn(
          "fixed left-1/2 top-3 z-[60] -translate-x-1/2",
          className,
        )}
      >
        <div className="flex items-center gap-1 rounded-full border border-border/80 bg-card/95 px-1.5 py-1 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/90">
          <button
            onClick={goAdmin}
            disabled={busy || !isMemberView}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all",
              !isMemberView
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Shield className="h-3.5 w-3.5" />
            Admin
          </button>
          <div className="h-4 w-px bg-border" />
          <button
            onClick={goMember}
            disabled={busy || isMemberView}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all",
              isMemberView
                ? "bg-emerald-500 text-white shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <User className="h-3.5 w-3.5" />
            Member
          </button>
        </div>
      </div>
    );
  }

  // Banner variant (inline, full-width)
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b px-4 py-2",
        isMemberView
          ? "border-emerald-500/30 bg-emerald-500/10"
          : "border-primary/20 bg-primary/5",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <ArrowRightLeft className={cn("h-4 w-4", isMemberView ? "text-emerald-600" : "text-primary")} />
        <span className={isMemberView ? "text-emerald-900 dark:text-emerald-100" : "text-foreground"}>
          {isMemberView ? "Viewing as Member" : "Admin Dashboard"}
        </span>
      </div>
      <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
        <Button
          size="sm"
          variant={!isMemberView ? "default" : "ghost"}
          className="h-7 gap-1.5 px-2.5 text-xs"
          onClick={goAdmin}
          disabled={busy || !isMemberView}
        >
          <Shield className="h-3.5 w-3.5" />
          Admin
        </Button>
        <Button
          size="sm"
          variant={isMemberView ? "default" : "ghost"}
          className={cn(
            "h-7 gap-1.5 px-2.5 text-xs",
            isMemberView && "bg-emerald-600 hover:bg-emerald-700",
          )}
          onClick={goMember}
          disabled={busy || isMemberView}
        >
          <User className="h-3.5 w-3.5" />
          Member
        </Button>
      </div>
    </div>
  );
}

/**
 * Legacy POV banner shown inside the member layout when active.
 * Kept for backward compatibility; consider replacing with PovQuickToggle.
 */
export function PovBanner() {
  const navigate = useNavigate();
  const { active, persona } = getPovFlag();
  if (!active) return null;

  const labels: Record<string, string> = {
    app_member: "App Member",
    app_member_premium: "App Member (Premium)",
    program_only: "Program-Only Buyer",
    none: "Locked / No Access",
  };

  return (
    <div className="sticky top-0 z-50 flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-amber-900 dark:text-amber-100">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Eye className="h-4 w-4" />
        Previewing as{" "}
        <span className="font-bold">{labels[persona ?? ""] ?? persona}</span>
        <span className="hidden text-xs opacity-70 sm:inline">
          — writes go to your admin sandbox member, not real subscribers.
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1.5"
        onClick={() => {
          setPovFlag(null);
          navigate({ to: "/admin" });
        }}
      >
        Exit POV
      </Button>
    </div>
  );
}
