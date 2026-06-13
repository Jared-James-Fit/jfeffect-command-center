import { useNavigate, useLocation, useRouterState } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Briefcase, Sparkles, Film, Shield, User, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useDashboardMode, type DashboardMode } from "@/lib/dashboard-mode";
import { setPovPersona } from "@/lib/pov.functions";
import { getPovFlag, setPovFlag } from "@/components/pov-quick-toggle";
import { KeyboardShortcutsButton } from "@/components/keyboard-shortcuts";

/**
 * Consolidated sticky top bar for the admin/coach layout.
 * Combines: dashboard mode tabs · admin/member POV toggle · keyboard shortcuts.
 * Designed to replace the three separate rows that previously stacked above
 * the page header.
 */
export function AdminTopBar({ showDashboardMode = true }: { showDashboardMode?: boolean }) {
  const [mode, setMode] = useDashboardMode();
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const qc = useQueryClient();
  const setPersona = useServerFn(setPovPersona);
  const [busy, setBusy] = useState(false);
  const pov = getPovFlag();
  const isMemberView = pov.active || location.pathname.startsWith("/m");

  const selectMode = (m: DashboardMode) => {
    setMode(m);
    if (m === "media") {
      if (!pathname.startsWith("/media")) navigate({ to: "/media" });
      return;
    }
    if (m === "membership") {
      if (!pathname.startsWith("/admin/membership")) navigate({ to: "/admin/membership" });
      return;
    }
    if (pathname.startsWith("/admin/membership") || pathname.startsWith("/media")) {
      navigate({ to: "/admin" });
    }
  };

  const goAdmin = useCallback(async () => {
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
  }, [busy, qc, navigate]);

  const goMember = useCallback(async () => {
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
  }, [busy, qc, setPersona, navigate]);

  return (
    <div
      className={cn(
        "sticky top-0 z-40 flex flex-wrap items-center justify-between gap-2 border-b px-3 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:px-6",
        isMemberView ? "border-emerald-500/30 bg-emerald-500/10" : "border-border bg-background/90",
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {showDashboardMode && (
          <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5 text-xs">
            <ModeTab active={mode === "coaching"} onClick={() => selectMode("coaching")} icon={<Briefcase className="h-3.5 w-3.5" />} label="Coaching" />
            <ModeTab active={mode === "membership"} onClick={() => selectMode("membership")} icon={<Sparkles className="h-3.5 w-3.5" />} label="Membership" />
            <ModeTab active={mode === "media"} onClick={() => selectMode("media")} icon={<Film className="h-3.5 w-3.5" />} label="Media" />
            <KeyboardShortcutsButton />
          </div>
        )}
        {!showDashboardMode && <KeyboardShortcutsButton />}
        <div className="hidden items-center gap-1.5 text-xs font-medium text-muted-foreground sm:flex">
          <ArrowRightLeft className={cn("h-3.5 w-3.5", isMemberView ? "text-emerald-600" : "text-primary")} />
          <span className={isMemberView ? "text-emerald-900 dark:text-emerald-100" : "text-foreground"}>
            {isMemberView ? "Viewing as Member" : "Admin"}
          </span>
        </div>
      </div>
      <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5">
        <PovBtn active={!isMemberView} onClick={goAdmin} disabled={busy || !isMemberView} icon={<Shield className="h-3.5 w-3.5" />} label="Admin" />
        <PovBtn active={isMemberView} onClick={goMember} disabled={busy || isMemberView} icon={<User className="h-3.5 w-3.5" />} label="Member" tint="emerald" />
      </div>
    </div>
  );
}

function ModeTab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function PovBtn({
  active, onClick, disabled, icon, label, tint,
}: { active: boolean; onClick: () => void; disabled?: boolean; icon: React.ReactNode; label: string; tint?: "emerald" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold transition-colors disabled:cursor-default",
        active
          ? tint === "emerald"
            ? "bg-emerald-600 text-white"
            : "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}