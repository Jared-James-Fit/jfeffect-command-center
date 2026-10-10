import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { splitTasks, firstName } from "@/lib/tasks";
import { noteSignature, noteToRow, rowToNote } from "@/lib/quick-notes-db";

const ME = "u-me";
const FI = "u-fionna";

describe("My tasks / Team boards", () => {
  const tasks = [
    { id: "p-me", owner_user_id: ME, assigned_to: null },
    { id: "p-fi", owner_user_id: FI, assigned_to: null },
    { id: "t-me", owner_user_id: null, assigned_to: ME },
    { id: "t-fi", owner_user_id: null, assigned_to: FI },
    { id: "t-none", owner_user_id: null, assigned_to: null },
  ];

  it("My tasks = my private tasks + team tasks assigned to me", () => {
    expect(splitTasks(tasks, ME).mine.map((t) => t.id)).toEqual(["p-me", "t-me"]);
  });

  it("Team = every shared task, never anyone's private one", () => {
    expect(splitTasks(tasks, ME).team.map((t) => t.id)).toEqual(["t-me", "t-fi", "t-none"]);
  });

  it("another person's private task never lands on my boards, even if the server sent it", () => {
    const { mine, team } = splitTasks(tasks, ME);
    expect([...mine, ...team].some((t) => t.id === "p-fi")).toBe(false);
  });

  it("first names for compact chips", () => {
    expect(firstName("Fionna Gaburno")).toBe("Fionna");
    expect(firstName("  ")).toBe("");
    expect(firstName(null)).toBe("");
  });
});

describe("Quick Notes are stored per person in the database", () => {
  it("round-trips a note through its row without changing what it saves", () => {
    const note = { id: "n1", title: "Marc - sessions", body: "32 done", updatedAt: 1_760_000_000_123, clientId: "c1", clientName: "Marc S" };
    const row = noteToRow(note, ME);
    expect(row.owner_user_id).toBe(ME);
    expect(row.client_id).toBe("c1");
    expect(noteSignature(rowToNote(row))).toBe(noteSignature(note));
  });

  it("keeps a trashed note's delete time", () => {
    const note = { id: "n2", title: "x", body: "", updatedAt: 1000, deletedAt: 5000 };
    expect(rowToNote(noteToRow(note, ME)).deletedAt).toBe(5000);
  });

  it("an unlinked note doesn't carry a stale client name", () => {
    expect(noteToRow({ id: "n3", title: "x", body: "", updatedAt: 1, clientName: "Old" }, ME).client_name).toBeNull();
  });

  it("the panel no longer keeps notes in device storage (only reads it once to carry old notes over)", () => {
    const src = readFileSync("src/components/tasks/quick-notes.tsx", "utf8");
    expect(src).not.toContain("localStorage.setItem(storageKey");
    expect(src).toContain("localStorage.removeItem(storageKey)");
  });
});

describe("privacy is enforced by the database", () => {
  const sql = readFileSync("supabase/migrations/20261031090000_private_tasks_and_quick_notes.sql", "utf8");
  it("private tasks use a RESTRICTIVE owner rule so no permissive rule can widen it", () => {
    expect(sql).toMatch(/AS RESTRICTIVE FOR ALL TO authenticated\s+USING \(owner_user_id IS NULL OR owner_user_id = auth\.uid\(\)\)/);
  });
  it("quick notes are owner-only", () => {
    expect(sql).toMatch(/ON public\.quick_notes\s+FOR ALL TO authenticated\s+USING \(owner_user_id = auth\.uid\(\)\)/);
  });
  it("viewing as someone else hides their private tasks and notes instead of showing yours", () => {
    const page = readFileSync("src/components/tasks/tasks-page.tsx", "utf8");
    expect(page).toContain("privateTo={privateTo}");
    expect(page).toContain("boardHidden");
  });
});

describe("Task Manager page", () => {
  it("is just the Task Manager: Library and Archive tabs are gone", () => {
    const route = readFileSync("src/routes/_authenticated/admin/content.tsx", "utf8");
    expect(route).not.toMatch(/ResourceLibrary|MediaArchivesPage/);
    expect(route).toContain('({ tab: "tasks" })');
  });
});
