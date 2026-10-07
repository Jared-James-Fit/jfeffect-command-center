import { EyeOff, Lock, UserRound, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { AUDIENCES, type CommunityVisibility } from "@/lib/community";

const ICON: Record<CommunityVisibility, typeof Users> = { community: Users, coach: UserRound, private: Lock };

/**
 * Who sees a post (JF crew / My coach / Only me) + "Hide my weights".
 * Shared by the workout share editor (light sheet) and Lock in (dark).
 */
export function AudiencePicker({
  value,
  onChange,
  hideLoads,
  onHideLoads,
  tone = "light",
}: {
  value: CommunityVisibility;
  onChange: (v: CommunityVisibility) => void;
  hideLoads: boolean;
  onHideLoads: (v: boolean) => void;
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";
  const hint = AUDIENCES.find((a) => a.key === value)?.hint;
  return (
    <div className="space-y-2">
      <div className={cn("grid grid-cols-3 gap-1 rounded-xl p-1", dark ? "bg-white/10" : "bg-muted")} role="radiogroup" aria-label="Who can see it">
        {AUDIENCES.map((a) => {
          const Icon = ICON[a.key];
          const on = value === a.key;
          return (
            <button
              key={a.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(a.key)}
              className={cn(
                "flex h-9 items-center justify-center gap-1 rounded-lg px-1 text-[12px] font-bold transition-colors",
                on ? (dark ? "bg-white text-black" : "bg-background text-foreground shadow-sm") : dark ? "text-white/70" : "text-muted-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{a.label}</span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className={cn("min-w-0 truncate text-[11px]", dark ? "text-white/55" : "text-muted-foreground")}>{hint}</span>
        <button
          type="button"
          role="switch"
          aria-checked={hideLoads}
          onClick={() => onHideLoads(!hideLoads)}
          className={cn(
            "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-bold transition-colors",
            hideLoads ? (dark ? "bg-white text-black" : "bg-foreground text-background") : dark ? "bg-white/10 text-white/75" : "bg-muted text-muted-foreground",
          )}
          title="Reps, sets, time and PRs still show. Only you see the weights."
        >
          <EyeOff className="h-3.5 w-3.5" />
          {hideLoads ? "Weights hidden" : "Hide weights"}
        </button>
      </div>
    </div>
  );
}

/** Short label for where a post went ("Sent to coach"). */
export function audienceDoneLabel(v: CommunityVisibility): string {
  return v === "community" ? "Posted" : v === "coach" ? "Sent to coach" : "Saved";
}
