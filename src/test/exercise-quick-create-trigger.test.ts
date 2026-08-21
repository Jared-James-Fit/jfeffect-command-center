/**
 * Regression guard for the iPhone/PWA "Add Exercise reloads the whole app"
 * bug. Tapping Add Exercise must be purely local UI state: no form submit,
 * no navigation, no document reload, and no re-mount of the authenticated
 * shell / dashboard splash.
 *
 * Also pins the PR #21 mobile form repairs so they cannot be undone.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const adminLibrary = readFileSync("src/routes/_authenticated/admin/exercises.tsx", "utf8");
const quickAddDialog = readFileSync("src/components/quick-add-exercise-dialog.tsx", "utf8");
const quickCreateForm = readFileSync("src/components/exercises/exercise-quick-create-form.tsx", "utf8");
const programBuilder = readFileSync("src/components/program-builder.tsx", "utf8");

describe("Add Exercise trigger is local UI state", () => {
  it("every Add exercise trigger button is type=button (cannot submit a parent form)", () => {
    const triggers = adminLibrary.match(/<Button[^>]*>\s*<Plus[^>]*\/>\s*Add exercise/g) ?? [];
    expect(triggers.length).toBeGreaterThanOrEqual(2);
    for (const trigger of triggers) expect(trigger).toContain('type="button"');
  });

  it("does not navigate or reload the document to open quick-create", () => {
    for (const source of [adminLibrary, quickAddDialog, quickCreateForm]) {
      expect(source).not.toContain("location.reload");
      expect(source).not.toContain("location.href =");
      expect(source).not.toContain("location.assign");
      expect(source).not.toContain("router.invalidate");
      expect(source).not.toMatch(/navigate\(\{\s*to:/);
    }
  });

  it("opens quick-create through local dialog state, not a route", () => {
    expect(adminLibrary).toContain("<Dialog open={open} onOpenChange={setOpen}>");
    expect(programBuilder).toContain("onClick={() => setQuickAddOpen(true)}");
    expect(programBuilder).toContain("type=\"button\"");
  });

  it("never invalidates the whole query cache or the auth session from this flow", () => {
    for (const source of [adminLibrary, quickAddDialog, quickCreateForm]) {
      expect(source).not.toMatch(/invalidateQueries\(\s*\)/);
      expect(source).not.toContain("supabase.auth.signOut");
    }
  });
});

describe("admin library stays lightweight on mobile", () => {
  it("windows the exercise grid instead of rendering ~1700 cards", () => {
    expect(adminLibrary).toContain("const [visibleCount, setVisibleCount] = useState(ADMIN_PAGE)");
    expect(adminLibrary).toContain("{visible.map((e) => (");
    expect(adminLibrary).toContain("IntersectionObserver");
  });

  it("pauses focus refetching while the quick-create dialog is open", () => {
    expect(adminLibrary).toContain("refetchOnWindowFocus: !open");
  });
});

describe("PR #21 mobile repairs remain intact", () => {
  it("keeps touch focus recovery", () => {
    expect(quickCreateForm).toContain("focusNameFromTouchGesture");
    expect(quickCreateForm).toContain("autoFocus={!coarsePointer}");
    expect(quickCreateForm).toContain('event.pointerType === "touch"');
  });

  it("keeps the failed-save busy-state cleanup in a finally block", () => {
    expect(quickCreateForm).toContain("finally {");
    expect(quickCreateForm).toContain("setBusy(false)");
    expect(quickCreateForm).toContain("submittingRef.current = false");
  });

  it("guards against a double open/submit from one mobile tap", () => {
    expect(quickCreateForm).toContain("if (!trimmed || busy || submittingRef.current) return;");
  });

  it("updates exercise caches immediately on a successful save", () => {
    expect(quickCreateForm).toContain("upsertExerciseInLibraryCaches(qc, data as never)");
    expect(quickCreateForm).toContain("invalidateExerciseLibrary(qc)");
  });
});
