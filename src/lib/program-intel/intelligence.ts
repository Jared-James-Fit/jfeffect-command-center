/**
 * Generate Next Program, stages 1–3 (deterministic): from one full-history
 * read of the athlete's records, the previous program and every program
 * before it, measured; the athlete's context; the data-quality audit; what
 * the previous program tells us; patterns across cycles; the framework
 * (brain); and the recommended setup. Runs on the coach's phone (instantly)
 * and again in the background worker, so the AI receives exactly what the
 * coach saw (the data hash ties them together).
 */
import { isAtHomeBackupReservedBlock } from "@/lib/at-home-backup";
import { buildAthleteContext, type AthleteContext } from "./context";
import { resolveEquipment, type EquipmentResolution } from "./equipment";
import { currentProgramBlocks, isUnassignedDraftBlock, sliceRecords } from "./load";
import { findPatterns, type Pattern } from "./patterns";
import { dataQuality, type DataQuality } from "./quality";
import { recommendSetup, type SetupRecommendation } from "./recommend";
import { buildIntelReport } from "./report";
import { reviewPreviousProgram, type ProgramReview } from "./review";
import type { Brain, Classification, IntelRecords, IntelReport, RawBlock, RawExercise } from "./types";
import { BRAIN_LABEL } from "./types";

export type GeneratorIntel = {
  history: IntelReport;
  prev: IntelReport | null;
  prevRec: IntelRecords | null;
  prevLabel: string;
  classification: Classification;
  brain: Brain;
  brainSource: "auto" | "override";
  equipment: EquipmentResolution;
  ctx: AthleteContext;
  quality: DataQuality | null;
  review: ProgramReview | null;
  patterns: Pattern[];
  recommendation: SetupRecommendation;
  exercises: Map<string, RawExercise>;
  dataHash: string;
  /** Nothing logged yet: a first program, built from their Goals & Setup and your notes. */
  firstProgram: boolean;
};

/** Blocks that are a coach's draft nobody has seen yet (hidden and undated) never count as a program the athlete did (the loader leaves them out too). */
export const isUnassignedDraft = (b: RawBlock): boolean => isUnassignedDraftBlock(b);

/** The athlete's programs in order: a meet prep's blocks together, any other block on its own. */
export function programGroups(rec: IntelRecords): Array<{ label: string; blockIds: string[]; start: string | null }> {
  const live = rec.blocks.filter((b) => !isUnassignedDraft(b) && !isAtHomeBackupReservedBlock(b));
  const groups = new Map<string, RawBlock[]>();
  for (const b of live) {
    const k = b.prep_id ? `prep:${b.prep_id}` : `block:${b.id}`;
    groups.set(k, [...(groups.get(k) ?? []), b]);
  }
  const prepTitle = new Map(rec.preps.map((p) => [p.id, p.title ?? p.event_name ?? null]));
  return [...groups.entries()]
    .map(([k, bs]) => {
      const start = bs.map((b) => b.start_date).filter(Boolean).sort()[0] ?? null;
      const label = k.startsWith("prep:") ? prepTitle.get(bs[0].prep_id as string) ?? `Program of ${bs.length} blocks` : bs[0].name ?? "Block";
      return { label, blockIds: bs.map((b) => b.id), start };
    })
    .sort((a, b) => String(a.start ?? "9999").localeCompare(String(b.start ?? "9999")));
}

export function buildGeneratorIntel(rec: IntelRecords, opts: { brainOverride?: Brain | null; generatedAt?: string } = {}): GeneratorIntel {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const history = buildIntelReport(rec, { brainOverride: opts.brainOverride ?? null, generatedAt });
  const live = rec.blocks.filter((b) => !isUnassignedDraft(b));
  const cur = currentProgramBlocks(live, rec.today);
  const prepTitle = cur.prepId ? rec.preps.find((p) => p.id === cur.prepId)?.title ?? null : null;
  const prevLabel = prepTitle ?? (cur.blocks.length === 1 ? cur.blocks[0].name ?? "Last block" : "Last program");
  const prevRec = cur.blocks.length ? sliceRecords(rec, cur.blocks.map((b) => b.id), prevLabel) : null;
  // The framework is read from the program being followed up (plus goals, meets and notes).
  const prevAuto = prevRec ? buildIntelReport(prevRec, { generatedAt }) : null;
  const classification = prevAuto?.classification ?? history.classification;
  const brain = opts.brainOverride ?? classification.auto;
  const prev = prevRec ? buildIntelReport(prevRec, { brainOverride: brain, generatedAt }) : null;
  const exercises = new Map(rec.exercises.map((e) => [e.id, e]));
  const equipment = resolveEquipment(rec, cur.blocks.map((b) => b.id), exercises);
  const programs = programGroups(rec)
    .map((g) => {
      const r = sliceRecords(rec, g.blockIds, g.label);
      return { rec: r, report: buildIntelReport(r, { brainOverride: brain, generatedAt }), label: g.label };
    })
    .filter((p) => p.report.days.length > 0);
  const ctx = buildAthleteContext({ rec, history, prevRec, prev, prevLabel, programs, equipment });
  const quality = prev && prevRec ? dataQuality(prev, prevRec) : history.days.length ? dataQuality(history, rec) : null;
  const review = prev && quality ? reviewPreviousProgram(prev, ctx, quality) : null;
  const patterns = findPatterns(history, rec);
  const brainWhy = opts.brainOverride
    ? `Set by you (auto-classification read ${BRAIN_LABEL[classification.auto]}).`
    : `${classification.reasons.slice(0, 4).join("; ")}.`;
  const recommendation = recommendSetup({ ctx, brain, brainWhy, prev, history, review, patterns, exercises });
  return {
    history,
    prev,
    prevRec,
    prevLabel,
    classification,
    brain,
    brainSource: opts.brainOverride ? "override" : "auto",
    equipment,
    ctx,
    quality,
    review,
    patterns,
    recommendation,
    exercises,
    dataHash: history.dataHash,
    firstProgram: history.coverage.loggedSets === 0,
  };
}
