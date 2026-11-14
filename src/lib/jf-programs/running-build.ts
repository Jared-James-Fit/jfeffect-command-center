/**
 * The three running programs (running.ts) as pl_templates rows in the builder's
 * v2 format, one block per phase, the same shape build.ts makes for the
 * strength library, so Assign (pl_assign_template_to_client), the builder,
 * Edit with AI and the logger treat them like any other program. Pure.
 */
import type { TemplateRow } from "./build";
import { RUN_EXERCISES, RUN_PROGRAMS, RUN_TEMPLATE_IDS, type RunProgramDef, type RunRow } from "./running";

function runRowJson(r: RunRow, sortOrder: number) {
  const ex = RUN_EXERCISES[r.ex];
  return {
    sort_order: sortOrder,
    exercise_id: ex.id,
    exercise_name_override: ex.name,
    sets: r.sets,
    // what a row with no time target is ("5 km", "Race"); a timed row's reps_text stays empty
    reps_text: r.seconds == null ? r.label ?? null : null,
    rpe: r.rpe,
    rir: null,
    percentage: null,
    percentage_basis: "none",
    load_kg: null,
    manual_override: false,
    rest_seconds: r.rest ?? 0,
    time_profile: "accessory_isolation",
    notes: r.note ?? null,
    purpose_label: r.role,
    measurement_type: "time",
    tracking_type: "time",
    duration_seconds: r.seconds,
    card_color: null,
  };
}

export function buildRunPayload(p: RunProgramDef) {
  let week = 0;
  return {
    schema_version: "2",
    blocks_data: p.phases.map((ph, bi) => ({
      id: `${p.slug}:b${bi + 1}`,
      name: ph.name,
      goal: null,
      notes: "",
      phase: ph.focus,
      training_focus: ph.focus,
      weeks_data: ph.weeks.map((w, wi) => {
        week++;
        return {
          week_index: wi + 1,
          phase: `Week ${week} · ${ph.name}${w.lowerStress ? " (lower stress)" : ""}`,
          notes: w.purpose,
          days: w.days.map((d, di) => ({
            day_index: di + 1,
            title: d.title,
            focus: d.focus,
            notes: null,
            ...(d.optional ? { is_optional: true } : {}),
            rows: d.rows.map((r, ri) => runRowJson(r, ri)),
          })),
        };
      }),
    })),
  };
}

export const runProgramWeeks = (p: RunProgramDef) => p.phases.reduce((n, ph) => n + ph.weeks.length, 0);

export function buildRunTemplate(p: RunProgramDef): TemplateRow {
  const notes = [
    p.coachGuide,
    p.changes.length ? `\nChanges from the JF Effect running master spec (Nov 14 2026), and why:\n${p.changes.map((c) => `- ${c}`).join("\n")}` : "",
  ].join("");
  return {
    id: RUN_TEMPLATE_IDS[p.slug] ?? (() => { throw new Error(`no fixed id for ${p.slug}`); })(),
    slug: p.slug,
    name: p.name,
    template_type: "block",
    training_style: "conditioning",
    training_focus: p.phases[0].focus,
    tags: p.tags,
    status: "Published",
    weeks: runProgramWeeks(p),
    days_per_week: p.coreDays + p.optionalDays,
    est_duration_min: p.minutes,
    goal: p.goal,
    description: p.description,
    notes,
    payload: buildRunPayload(p),
  };
}

export const buildRunningLibrary = (): TemplateRow[] => RUN_PROGRAMS.map(buildRunTemplate);
