/**
 * Fixture tables for running Program Intelligence and the program editor
 * locally against a made-up athlete (the test suite's home-gym scenario, with
 * a few pain reports and a session limit), for screenshots. Nothing here
 * touches a database: the screenshot harness answers every request from it.
 *
 *   npx tsx scripts/program-intel-fixtures.ts <out.json>
 */
import { writeFileSync } from "node:fs";
import { homeGym } from "../src/test/program-intel-scenarios";

const rec = homeGym();
const USER_ID = "11111111-2222-4333-8444-555555555555";
const exById = new Map(rec.exercises.map((e) => [e.id, e]));
const pain = [
  { day: rec.days[rec.days.length - 9]?.id, area: "Shoulder (L)", level: 3, note: "pinch on incline" },
  { day: rec.days[rec.days.length - 7]?.id, area: "Shoulder (L), Low back", level: 4, note: null },
  { day: rec.days[rec.days.length - 5]?.id, area: "Other", level: 6, note: "left shoulder again on presses" },
];
const feedback = [
  ...rec.feedback,
  ...pain.filter((p) => p.day).map((p, i) => {
    const d = rec.days.find((x) => x.id === p.day)!;
    return { id: `fp-${i}`, day_id: d.id, completion_id: null, created_at: `${d.scheduled_date}T19:30:00Z`, session_rpe: 8, overall_rating: 3, strength_feel: null, fatigue_feel: "tired", hit_target: null, recovery_today: null, sleep_bucket: "6-7", pain: true, pain_area: p.area, pain_level: p.level, pain_note: p.note, client_note: null, review_version: 2, client_id: rec.client.id };
  }),
];
const tables: Record<string, unknown[]> = {
  user_roles: [{ role: "admin", user_id: USER_ID }],
  profiles: [{ id: USER_ID, full_name: "Jared McIntyre", avatar_url: null }],
  clients: [{ ...rec.client, user_id: "99999999-2222-4333-8444-555555555555", status: "Active", service_tier: "coaching", committed_training_days: ["Monday", "Tuesday", "Thursday", "Friday"], first_name: "Test", last_name: "Athlete" }],
  client_goals_setup: rec.goals ? [{ ...rec.goals, client_id: rec.client.id, workout_length_minutes: 60, updated_at: "2026-10-01T00:00:00Z" }] : [],
  pl_blocks: rec.blocks.map((b) => ({ ...b, client_id: rec.client.id, est_minutes_per_workout: 60, week_duration_days: 7, updated_at: "2026-11-01T00:00:00Z" })),
  pl_weeks: rec.weeks,
  pl_days: rec.days.map((d) => ({ ...d, subtitle: d.title, is_optional: false })),
  pl_exercise_rows: rec.rows.map((r) => ({ ...r, exercises: r.exercise_id ? { ...exById.get(r.exercise_id), video_url: "https://example.com/v" } : null })),
  pl_row_results: rec.results.map((r) => ({ ...r, client_id: rec.client.id })),
  pl_day_completions: rec.completions.map((c) => ({ ...c, client_id: rec.client.id })),
  pl_workout_feedback: feedback,
  exercises: rec.exercises.map((e) => ({ ...e, video_url: "https://example.com/v", archived: false })),
  program_intel_jobs: [],
  program_intel_observations: [],
  pl_client_maxes: [],
  program_block_types: [],
  // the dark-mode news is already seen (the fixture account is older than it)
  feature_announcement_views: [{ feature_key: "theme_toggle_2026_10", user_id: USER_ID }],
};
writeFileSync(process.argv[2] ?? "intel-fixtures.json", JSON.stringify({ tables, clientId: rec.client.id, blockId: rec.blocks[rec.blocks.length - 1].id, blocks: rec.blocks.map((b) => b.id) }));
console.log("wrote", Object.keys(tables).length, "tables; client", rec.client.id, "blocks", rec.blocks.map((b) => `${b.id}:${b.name}`).join(", "));
