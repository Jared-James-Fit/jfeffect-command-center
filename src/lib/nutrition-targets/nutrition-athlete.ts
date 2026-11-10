/**
 * The athlete as the nutrition AI reads them: the same deterministic read
 * Program Intelligence gives every training AI (buildAthleteDevelopment:
 * bodyweight phases as a least-squares trend, each competition lift's
 * strength in each bodyweight phase, training age, the weight class and the
 * rate it takes to make it, workout adherence, fatigue, what isn't on file),
 * plus their goals and the next meet. The exercise-by-exercise signals are
 * left out: nutrition reads the athlete, it never changes the program. Pure;
 * the server builds it from loadIntelRecords + buildGeneratorIntel.
 */
import { developmentText, type AthleteDevelopment } from "@/lib/program-intel/athlete-development";
import type { AthleteContext } from "@/lib/program-intel/context";

const fmt = (iso: string | null | undefined) =>
  iso
    ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;

export function nutritionAthleteText(ctx: AthleteContext, dev: AthleteDevelopment): string {
  const g = ctx.goals;
  const goals = [
    g.main ? `main goal: ${g.main}${g.other ? ` (${g.other})` : ""}` : null,
    g.target ? `target: ${g.target}` : null,
    g.clientGoals ? `in their words: ${g.clientGoals}` : null,
    g.longTerm?.text
      ? `long-term goal (coach-set): ${g.longTerm.text}${g.longTerm.date ? ` by ${fmt(g.longTerm.date)}` : ""}`
      : null,
  ].filter(Boolean);
  const next = ctx.competition.next;
  const lines = ["ATHLETE (computed from their records in the app; never fill in what isn't here)"];
  lines.push(
    goals.length ? `Goals: ${goals.join(" · ")}` : "Goals: nothing on file beyond this form",
  );
  if (next)
    lines.push(
      `Next meet: ${next.name} on ${fmt(next.date)} (${next.weeksOut} weeks out)${next.weightClass ? ` · weight class ${next.weightClass}` : " · no weight class on file"}`,
    );
  lines.push(developmentText(dev, ctx.unit, { exercises: false }));
  return lines.join("\n");
}
