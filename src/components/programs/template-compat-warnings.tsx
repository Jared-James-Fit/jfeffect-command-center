import { Info } from "lucide-react";
import { deriveFacets, type FacetSource } from "@/lib/programs/facets";
import type { GoalsSetupInput } from "@/lib/programs/recommend";

type Props = {
  template: FacetSource | null;
  goals: GoalsSetupInput | null;
};

/**
 * Non-blocking advisory shown when a coach picks a template for a client.
 * Surfaces obvious mismatches (days/week, length, location, level) so the
 * coach can adjust expectations — never prevents assignment.
 */
export function TemplateCompatWarnings({ template, goals }: Props) {
  if (!template || !goals) return null;
  const f = deriveFacets(template);
  const notes: string[] = [];

  if (goals.training_days_per_week && f.daysPerWeek
      && f.daysPerWeek !== goals.training_days_per_week) {
    notes.push(
      `Template is ${f.daysPerWeek} days/week — client trains ${goals.training_days_per_week} days/week.`,
    );
  }

  if (goals.workout_length_minutes && f.lengthMin
      && f.lengthMin > goals.workout_length_minutes + 10) {
    notes.push(
      `Sessions run ~${f.lengthMin} min — client prefers ${goals.workout_length_minutes} min.`,
    );
  }

  const wantHome = /home|apartment|limited/i.test(goals.training_location ?? "");
  if (wantHome && f.location === "gym" && f.equipmentNeeded.some((e) =>
    ["cable", "machine", "smith", "rack"].includes(e))) {
    notes.push("Template assumes commercial gym equipment — client trains at home.");
  }

  const wantExp = (goals.training_experience ?? "").toLowerCase();
  if (f.level === "advanced" && /beginner|new|<1/.test(wantExp)) {
    notes.push("Template is advanced — client reports beginner experience.");
  }

  if (notes.length === 0) return null;
  return (
    <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2 text-[11px] text-blue-700 dark:text-blue-300">
      <div className="flex items-start gap-1.5">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        <div className="flex-1 space-y-0.5">
          <div className="font-semibold">Things to review</div>
          <ul className="list-disc pl-3">
            {notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}