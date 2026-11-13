/**
 * Turns the 12 program definitions into pl_templates rows in the builder's
 * own v2 format (template_type "block", schema_version "2", blocks_data →
 * weeks_data → days → rows), the format pl_assign_template_to_client copies
 * onto a client as one prep with three blocks. Pure (no Node APIs): the
 * migration generator and the production installer both use it.
 *
 * Ids are fixed (JF_TEMPLATE_IDS), so the import is idempotent: running it
 * again finds the same 12 ids and adds nothing.
 */
import { EX } from "./catalog";
import { JF_PROGRAMS, type ProgramDef } from "./programs";
import { WEEKS, blockOf, weekPhase, type WeekRow } from "./progression";

/**
 * Each program's fixed id: a UUID (v5 layout) hashed from "jf-effect-library:"
 * + its slug. Written out so the app never needs a hash at runtime; the test
 * re-derives every one (stableUuid in sql.ts).
 */
export const JF_TEMPLATE_IDS: Record<string, string> = {
  "jf-strength-foundation": "642972ad-d197-51d1-b272-85f37b3b0911",
  "jf-strength-development": "10791be4-dd5b-5183-b724-75d750971b25",
  "jf-elite-powerlifting": "4df8c2ce-476e-5a99-9550-6244dd931111",
  "jf-muscle-foundation": "2f3cbdab-36f4-5e9b-b491-a4fcfe496a81",
  "jf-muscle-strength": "ce5ba49b-7172-59dd-8623-879c00872982",
  "jf-physique-specialization": "2c6afad5-83b8-5197-a9e4-0cbaae09442c",
  "jf-fitness-foundation": "7dcc2281-fcf3-51ac-ae3f-6cfcb559ea6a",
  "jf-glute-physique-builder": "f6125bc9-966d-5886-aed6-b35123edc9ba",
  "jf-advanced-physique": "f75d80f5-2a09-562a-9c9c-bbdbb55b9261",
  "jf-bodyweight-foundation": "0d6dc03d-cd4f-5ab1-9e53-f1cfeda2232e",
  "jf-dumbbell-muscle-builder": "9ef5e4b4-ac6f-5fad-b51f-d3390cc999e9",
  "jf-at-home-physique-builder": "967ca531-3098-5501-b3b7-9c2c571d2c4c",
};

export type TemplateRow = {
  id: string;
  slug: string;
  name: string;
  template_type: "block";
  training_style: string;
  training_focus: string;
  tags: string[];
  status: "Published";
  weeks: number;
  days_per_week: number;
  est_duration_min: number;
  goal: string;
  description: string;
  notes: string;
  payload: any;
};

function rowJson(r: WeekRow, sortOrder: number) {
  const ex = EX[r.ex];
  const timedRow = r.seconds != null;
  return {
    sort_order: sortOrder,
    exercise_id: ex.id,
    exercise_name_override: ex.name,
    sets: r.sets,
    reps_text: timedRow ? null : r.reps ?? null,
    rpe: r.rpe ?? null,
    rir: r.rpe ? null : r.rir ?? null,
    percentage: r.pctOfTop ?? null,
    percentage_basis: r.pctOfTop != null ? "top_set" : "none",
    load_kg: null,
    manual_override: false,
    rest_seconds: r.rest,
    time_profile: ex.timeProfile,
    notes: r.note ?? null,
    purpose_label: r.role ?? null,
    measurement_type: timedRow ? "time" : "reps",
    tracking_type: timedRow ? "time" : "reps_weight",
    duration_seconds: timedRow ? r.seconds : null,
    card_color: null,
  };
}

export function buildPayload(p: ProgramDef) {
  const blocks = [1, 2, 3].map((b) => ({
    id: `${p.slug}:b${b}`,
    name: p.blockNames[b - 1],
    goal: null,
    notes: "",
    phase: p.blockFocus[b - 1],
    training_focus: p.blockFocus[b - 1],
    weeks_data: [] as any[],
  }));
  for (let week = 1; week <= WEEKS; week++) {
    const block = blocks[blockOf(week) - 1];
    block.weeks_data.push({
      week_index: ((week - 1) % 4) + 1,
      phase: `Week ${week} · ${weekPhase(p.track, week)}`,
      notes: null,
      days: p.days.map((d, di) => {
        const rows = d.slots.flatMap((slot) => slot.rows(week));
        return {
          day_index: di + 1,
          title: d.title,
          focus: d.focus,
          notes: null,
          ...(d.optional ? { is_optional: true } : {}),
          rows: rows.map((r, ri) => rowJson(r, ri)),
        };
      }),
    });
  }
  return { schema_version: "2", blocks_data: blocks };
}

export function buildTemplate(p: ProgramDef): TemplateRow {
  const optionalDays = p.days.filter((d) => d.optional).length;
  const notes = [
    p.coachGuide,
    p.changes.length ? `\nChanges from the JF Effect master spec (Nov 13 2026), and why:\n${p.changes.map((c) => `- ${c}`).join("\n")}` : "",
  ].join("");
  return {
    id: JF_TEMPLATE_IDS[p.slug] ?? (() => { throw new Error(`no fixed id for ${p.slug}`); })(),
    slug: p.slug,
    name: p.name,
    template_type: "block",
    training_style: p.style,
    training_focus: p.blockFocus[0],
    tags: p.tags,
    status: "Published",
    weeks: WEEKS,
    days_per_week: p.coreDays + optionalDays,
    est_duration_min: p.minutes,
    goal: p.goal,
    description: p.description,
    notes,
    payload: buildPayload(p),
  };
}

export const buildLibrary = (): TemplateRow[] => JF_PROGRAMS.map(buildTemplate);

/** What a template holds, counted from its payload: used by the test, the installer's preview and its read-back. */
export function payloadSummary(payload: any) {
  let blocks = 0, weeks = 0, coreDays = 0, optionalDays = 0, rows = 0;
  for (const b of payload?.blocks_data ?? []) {
    blocks++;
    for (const w of b.weeks_data ?? []) {
      weeks++;
      for (const d of w.days ?? []) {
        if (d.is_optional) optionalDays++;
        else coreDays++;
        rows += (d.rows ?? []).length;
      }
    }
  }
  return { blocks, weeks, coreDays, optionalDays, rows };
}
