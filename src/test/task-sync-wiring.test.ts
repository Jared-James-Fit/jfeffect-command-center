import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/20261006000000_task_manager_cross_device_sync.sql", "utf8");
const page = readFileSync("src/components/tasks/tasks-page.tsx", "utf8");

describe("Task Manager cross-device sync wiring", () => {
  it("keeps notes and settings private to their owner", () => {
    for (const t of ["task_quick_notes", "task_preferences"]) {
      expect(migration).toContain(`alter table public.${t} enable row level security`);
      for (const op of ["select", "insert", "update", "delete"]) {
        expect(migration).toContain(`"${t} owner ${op}"`);
      }
    }
    expect(migration).not.toMatch(/to anon/i);
    expect(migration).not.toMatch(/has_role|is_coach_or_admin/); // owner-only, not shared with other staff
  });

  it("bumps a version on every update so stale writes can be detected", () => {
    expect(migration).toContain("new.version := coalesce(old.version, 0) + 1");
    expect(migration).toContain("before update on public.task_quick_notes");
    expect(migration).toContain("before update on public.task_preferences");
  });

  it("publishes both tables to realtime with a full replica identity", () => {
    expect(migration).toContain("alter publication supabase_realtime add table public.task_quick_notes");
    expect(migration).toContain("alter publication supabase_realtime add table public.task_preferences");
    expect(migration).toContain("replica identity full");
  });

  it("the Task Manager turns sync on for notes, assignees and quadrant styles", () => {
    expect(page).toContain("syncScope={scope}");
    expect(page).toContain('field: "assignees"');
    expect(page).toContain('field: "quadrant_styles"');
    // storage keys are unchanged so existing local data is picked up as-is
    expect(page).toContain("storageKey={`${storagePrefix}-task-notes`}");
    expect(page).toContain("`${storagePrefix}-task-assignees`");
    expect(page).toContain("`${storagePrefix}-quadrant-styles`");
  });
});
