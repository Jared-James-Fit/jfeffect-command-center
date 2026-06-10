import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useDashboardMode, type DashboardMode } from "@/lib/dashboard-mode";
import { Briefcase, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function DashboardModeSwitcher() {
  const [mode, setMode] = useDashboardMode();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  const select = (m: DashboardMode) => {
    setMode(m);
    if (m === "membership" && !pathname.startsWith("/admin/membership")) {
      navigate({ to: "/admin/membership" });
    } else if (m === "coaching" && pathname.startsWith("/admin/membership")) {
      navigate({ to: "/admin" });
    }
  };

  return (
    <div className="mx-4 mt-4 inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1 text-xs md:mx-6">
      <span className="px-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Dashboard Mode</span>
      <Tab active={mode === "coaching"} onClick={() => select("coaching")} icon={<Briefcase className="h-3.5 w-3.5" />} label="Coaching" />
      <Tab active={mode === "membership"} onClick={() => select("membership")} icon={<Sparkles className="h-3.5 w-3.5" />} label="Membership" />
    </div>
  );
}

function Tab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 font-semibold transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {icon}{label}
    </button>
  );
}