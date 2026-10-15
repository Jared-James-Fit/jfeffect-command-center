import { EyeOff, Lock, Star, UserRound, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { AUDIENCES, pickerAudience, type CommunityVisibility } from "@/lib/community";
import { useFollowState } from "@/lib/community-social";

const ICON: Record<CommunityVisibility, typeof Users> = { community: Users, followers: Users, close_friends: Star, coach: UserRound, private: Lock };

/**
 * Who sees a post (JF crew, or Followers on a private account / Close friends /
 * My coach / Only me) + "Hide my weights".
 * Shared by the workout share editor (light sheet) and Lock in (dark).
 */
export function AudiencePicker({
  value,
  onChange,
  hideLoads,
  onHideLoads,
  tone = "light",
  autoStory = false,
}: {
  value: CommunityVisibility;
  onChange: (v: CommunityVisibility) => void;
  hideLoads: boolean;
  onHideLoads: (v: boolean) => void;
  tone?: "light" | "dark";
  /** Editing an automatic workout story (a Pulse): its crew choice reaches everyone, private account or not. */
  autoStory?: boolean;
}) {
  const dark = tone === "dark";
  const audiences = useAudiences(autoStory);
  const picked = pickerAudience(value);
  const hint = audiences.find((a) => a.key === picked)?.hint;
  return (
    <div className="space-y-2">
      <div className={cn("grid grid-cols-2 gap-1 rounded-xl p-1 sm:grid-cols-4", dark ? "bg-white/10" : "bg-muted")} role="radiogroup" aria-label="Who can see it">
        {audiences.map((a) => {
          const Icon = ICON[a.key];
          const on = picked === a.key;
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
              <Icon className={cn("h-3.5 w-3.5 shrink-0", a.key === "close_friends" && "fill-emerald-500 text-emerald-500")} />
              <span className="truncate">{a.label}</span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className={cn("line-clamp-2 min-w-0 text-[11px] leading-snug", dark ? "text-white/55" : "text-muted-foreground")}>{hint}</span>
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

/**
 * The audiences as this person sees them: a private account's crew choice
 * reads "Followers", and Close friends says so when the list is still empty
 * (a post to an empty list reaches nobody).
 */
export function useAudiences(autoStory = false) {
  const { data: follows } = useFollowState();
  return AUDIENCES.map((a) => {
    if (a.key === "community" && follows?.is_private)
      return autoStory
        ? { ...a, hint: "Your automatic workout stories show for the whole crew" }
        : { ...a, label: "Followers", hint: "Only the followers you've approved" };
    if (a.key === "close_friends" && follows && follows.close_friends.length === 0)
      return { ...a, hint: "Your Close friends list is empty. Add people from your profile first." };
    return a;
  });
}

/** Short label for where a post went ("Sent to coach"). */
export function audienceDoneLabel(v: CommunityVisibility): string {
  return v === "community" || v === "followers" ? "Posted" : v === "close_friends" ? "Close friends" : v === "coach" ? "Sent to coach" : "Saved";
}
