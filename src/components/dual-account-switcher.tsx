import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Dumbbell, Briefcase } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useDualAccount } from "@/hooks/use-dual-account";
import { useViewMode, setViewMode, type ViewMode } from "@/lib/view-mode";

/**
 * Prominent pill toggle shown to users who have BOTH a client account and a
 * staff role (admin / coach / media_manager). Lets them flip between the
 * Client portal (workouts, check-ins) and the Staff workspace (admin / media)
 * instantly — no sign-out required. Choice persists in localStorage per user.
 */
export function DualAccountSwitcher() {
  const { user } = useAuth();
  const { hasDual, staffDestination } = useDualAccount();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();
  const [, setLocalMode] = useViewMode(user?.id ?? null);

  if (!hasDual || !user?.id) return null;

  const inClient = pathname.startsWith("/portal");
  const currentMode: ViewMode = inClient ? "client" : "staff";

  const select = (mode: ViewMode) => {
    if (!user?.id) return;
    setViewMode(user.id, mode);
    setLocalMode(mode);
    if (mode === "client") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      navigate({ to: "/portal/workouts" as any, replace: true });
    } else {
      const dest = staffDestination ?? "/admin";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      navigate({ to: dest as any, replace: true });
    }
  };

  return (
    <div className="mx-3 mt-3 md:mx-6 md:mt-4">
      <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 shadow-sm">
        <span className="text-[10px] font-bold uppercase tracking-widest text-primary">View</span>
        <div className="inline-flex flex-1 items-center gap-1 rounded-lg bg-background p-1 text-xs">
          <Tab
            active={currentMode === "client"}
            onClick={() => select("client")}
            icon={<Dumbbell className="h-3.5 w-3.5" />}
            label="My Workouts"
          />
          <Tab
            active={currentMode === "staff"}
            onClick={() => select("staff")}
            icon={<Briefcase className="h-3.5 w-3.5" />}
            label={staffDestination === "/media" ? "Media" : "Admin / Staff"}
          />
        </div>
      </div>
    </div>
  );
}

function Tab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 font-semibold transition-colors",
        active ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}