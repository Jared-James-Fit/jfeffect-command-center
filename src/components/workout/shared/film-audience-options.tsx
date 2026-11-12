/**
 * Who sees a workout's film: Crew or Coach only, one neutral two-way control
 * with what the choice does under it. Shared by the end of the review
 * (workout-film.tsx) and Crew settings (privacy-settings.tsx); kept on its own
 * so settings never load the logger's video code.
 */
import { UserRound, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const CHOICES = [
  { key: "crew", label: "Crew", icon: Users },
  { key: "coach", label: "Coach only", icon: UserRound },
] as const;

/**
 * Crew or Coach only, as one neutral two-way control with what the choice
 * does under it. `when` is when a Crew film goes up ("after your review" in
 * the review, "when you finish" in settings).
 */
export function FilmAudienceOptions({
  crew,
  onChange,
  disabled,
  when,
}: {
  crew: boolean;
  onChange: (crew: boolean) => void;
  disabled?: boolean;
  when: string;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" role="radiogroup" aria-label="Who sees your film">
        {CHOICES.map(({ key, label, icon: Icon }) => {
          const on = (key === "crew") === crew;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              data-film-audience={key}
              onClick={() => !on && onChange(key === "crew")}
              className={cn(
                "flex h-10 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold transition-colors",
                on ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {label}
            </button>
          );
        })}
      </div>
      <p className="text-xs leading-snug text-muted-foreground" data-film-audience-hint>
        {crew
          ? `Posts to the feed ${when}, each clip with its set details.`
          : "Stays in your coach chat. You can share it to Crew later from the workout."}
      </p>
    </div>
  );
}
