import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A staff login linked to the person's own client account reads that
// account's calendar data (and nothing else), so the staff home's "My
// calendar" card isn't empty for the person themselves.
const sql = readFileSync("supabase/migrations/20261029090000_linked_login_reads_own_calendar.sql", "utf8");

describe("linked login reads its own calendar", () => {
  it("covers every table the client calendar reads", () => {
    for (const t of [
      "clients", "pt_sessions", "appointments", "important_dates", "event_assignments", "events",
      "pl_blocks", "pl_weeks", "pl_days", "pl_exercise_rows", "pl_scheduled_workouts",
      "pl_day_completions", "pl_row_results", "pl_workout_feedback",
      "nf_assignments", "cardio_targets", "nutrition_day_overrides",
    ]) {
      expect(sql).toContain(`on public.${t}\n  for select to authenticated`);
    }
  });
  it("is read-only and keeps the client's visibility rules", () => {
    expect(sql).not.toMatch(/for (all|insert|update|delete)/i);
    expect(sql).toContain("visible_to_client and client_id = (select public.linked_client_id())");
    expect(sql).toContain("client_visible and client_id = (select public.linked_client_id())");
  });
  it("only follows the admin-set link", () => {
    expect(sql).toContain("where cp.user_id = auth.uid()");
    expect(sql).toContain("revoke all on function public.linked_client_id() from public, anon;");
  });
});
