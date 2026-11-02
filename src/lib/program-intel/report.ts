/**
 * Program Intelligence: records in, report out. Pure and deterministic, so the
 * same records always give the same report (and the same data hash).
 */
import { hashText } from "@/lib/training-roadmap";
import { blockReports, bodyweightOf, buildGraph, coverage, exerciseReports, liftReports, muscleReports, recoveryOf, weekMetrics } from "./analyze";
import { brainFindings } from "./brains";
import { classifyProgram } from "./classify";
import type { Brain, IntelRecords, IntelReport } from "./types";

export const INTEL_VERSION = 1;

/** A fingerprint of everything the report reads, so an export or AI run can be traced to the exact records behind it. */
export function recordsHash(rec: IntelRecords): string {
  return hashText(
    JSON.stringify([
      rec.client.id,
      rec.scope,
      rec.rows.map((r) => [r.id, r.exercise_id, r.sets, r.reps_text, r.rpe, r.rir, r.percentage, r.load_kg, r.load_lb]),
      rec.results.map((r) => [r.id, r.normalized_kg, r.actual_reps, r.actual_rpe_num ?? r.actual_rpe, r.actual_rir, r.completed_at, r.is_working_set]),
      rec.completions.map((c) => [c.id, c.completed_at]),
      rec.feedback.map((f) => [f.id, f.session_rpe, f.pain]),
    ]),
  );
}

export function buildIntelReport(rec: IntelRecords, opts: { brainOverride?: Brain | null; generatedAt?: string } = {}): IntelReport {
  const unit = rec.client.preferred_weight_unit === "kg" ? "kg" : "lb";
  const g = buildGraph(rec);
  const weeks = weekMetrics(rec, g);
  const lifts = liftReports(rec, g, weeks);
  const muscles = muscleReports(rec, g, weeks);
  const exercises = exerciseReports(g);
  const blocks = blockReports(rec, g, weeks, lifts);
  const cov = coverage(rec, g);
  const recovery = recoveryOf(g);
  const bodyweight = bodyweightOf(rec);
  const classification = classifyProgram(rec);
  const brain = opts.brainOverride ?? classification.auto;
  const findings = brainFindings(brain, { rec, unit, weeks, lifts, muscles, exercises, blocks, coverage: cov, recovery, bodyweight });
  return {
    version: INTEL_VERSION,
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    dataHash: recordsHash(rec),
    client: { id: rec.client.id, name: rec.client.full_name?.trim() || "Athlete", unit },
    scope: rec.scope,
    brain,
    brainSource: opts.brainOverride ? "override" : "auto",
    classification,
    coverage: cov,
    days: g.days,
    weeks,
    lifts,
    muscles,
    exercises,
    blocks,
    recovery,
    bodyweight,
    findings,
  };
}
