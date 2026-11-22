/**
 * A JF Effect library plan as a PDF (Nov 22 2026): the plan a member is
 * looking at (`member_plans.published_payload`, already on their screen), as
 * the same Program PDF a coach's client gets (workout-pdf.ts), so every
 * program the app prints reads the same. Weeks are numbered through the whole
 * plan (a multi-block plan's weeks start at 1 in each block).
 */
import { generateProgramPdf, type FullTrainingReportData } from "@/lib/workouts/workout-pdf";
import { pdfFileName, pdfText } from "@/lib/pdf/text";
import { loadPdfLogo } from "@/lib/pdf/deliver";

type Payload = { blocks_data?: any[]; weeks_data?: any[]; days?: any[] } | null | undefined;

function payloadBlocks(payload: Payload): Array<{ name: string; weeks: any[] }> {
  if (!payload) return [];
  if (Array.isArray(payload.blocks_data) && payload.blocks_data.length) {
    return payload.blocks_data
      .filter((b) => b && !b.archived && !b.deleted)
      .map((b, i) => ({ name: pdfText(b?.name) || `Block ${i + 1}`, weeks: b?.weeks_data ?? [] }));
  }
  if (Array.isArray(payload.weeks_data)) return [{ name: "", weeks: payload.weeks_data }];
  if (Array.isArray(payload.days))
    return [{ name: "", weeks: [{ week_index: 1, days: payload.days }] }];
  return [];
}

/** The plan in the training PDF's own shape: prescriptions only, no dates (a library plan isn't on anyone's calendar). */
export function libraryPlanProgram(plan: any): FullTrainingReportData {
  let weekNo = 0;
  const blocks = payloadBlocks(plan?.published_payload).map((b) => ({
    block_name: b.name || pdfText(plan?.public_title || plan?.name) || "Program",
    block_status: null,
    block_start: null,
    block_end: null,
    weeks: (b.weeks ?? []).map((w: any, wi: number) => {
      weekNo++;
      return {
        id: `w${weekNo}`,
        week_index: weekNo,
        notes: w?.notes ?? null,
        days: (Array.isArray(w?.days) ? w.days : []).map((d: any, di: number) => ({
          id: `w${weekNo}d${di}`,
          day_index: Number(d?.day_index) || di + 1,
          title: d?.subtitle || d?.title || null,
          notes: d?.notes_client_visible === false ? null : (d?.notes ?? null),
          notes_client_visible: true,
          is_optional: !!d?.is_optional,
          scheduled_date: null,
          rows: (Array.isArray(d?.rows) ? d.rows : []).map((r: any, ri: number) => ({
            id: `w${weekNo}d${di}r${ri}`,
            sort_order: r?.sort_order ?? ri,
            exercise_name_override:
              (typeof r?.exercise_name_override === "string" && r.exercise_name_override.trim()) ||
              r?.exercise_name ||
              r?.name ||
              null,
            sets: r?.sets ?? r?.target_sets ?? null,
            reps_text:
              r?.reps_text ??
              (r?.reps != null
                ? String(r.reps)
                : r?.target_reps != null
                  ? String(r.target_reps)
                  : null),
            rpe: r?.rpe != null ? String(r.rpe) : null,
            rir: r?.rir != null ? String(r.rir) : null,
            percentage: r?.percentage ?? null,
            percentage_basis: r?.percentage_basis ?? null,
            load_kg: r?.load_kg ?? null,
            load_lb: r?.load_lb ?? null,
            load_unit: r?.load_unit ?? null,
            rest_seconds: r?.rest_seconds ?? null,
            tempo: r?.tempo ?? null,
            notes: r?.notes ?? null,
            measurement_type: r?.measurement_type ?? null,
            duration_seconds: r?.duration_seconds ?? null,
            purpose_label: r?.purpose_label ?? null,
          })),
        })),
      };
    }),
  }));
  const equipment = Array.isArray(plan?.equipment_needed)
    ? plan.equipment_needed.filter(Boolean).join(", ")
    : null;
  return {
    client_name: null,
    program_name: pdfText(plan?.public_title || plan?.name) || null,
    audience: "client",
    description: plan?.description ?? null,
    facts: [
      ["Level", pdfText(plan?.difficulty) || null],
      ["Style", pdfText(plan?.training_style) || null],
      ["Goal", pdfText(plan?.goal) || null],
      ["Equipment", equipment || null],
    ],
    blocks,
  };
}

/** Makes the plan's PDF and hands it over (the share sheet on a phone, a download on a computer). */
/** The plan as a PDF file, for the share sheet or a download. */
export async function libraryPlanPdfFile(plan: any): Promise<File> {
  const data = libraryPlanProgram(plan);
  return generateProgramPdf(data, { logo: await loadPdfLogo() }).toFile(
    pdfFileName({ document: "jf effect", detail: data.program_name ?? "program" }),
  );
}
