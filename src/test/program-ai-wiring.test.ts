import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { refsStillMatch } from "@/lib/program-ai/apply.server";
import { catalogFrom, toFullDays, toShortDays } from "@/lib/program-ai/load.server";
import { changeSchema } from "@/lib/program-ai/ops";
import { EDIT_SYSTEM_PROMPT } from "@/lib/program-ai/prompts";
import type { ProgramSnapshot } from "@/lib/program-ai/types";

const read = (p: string) => readFileSync(p, "utf8");
const MIGRATION = read("supabase/migrations/20270216090000_program_ai_editor.sql");

describe("Edit with AI is where the coach edits programs, and only there", () => {
  it("the client's Training tab, the block builder and the template editor each have it", () => {
    expect(read("src/components/clients/client-training-tab.tsx")).toContain('target={{ kind: "client", clientId, focusBlockId: focus.id }}');
    const builder = read("src/routes/_authenticated/admin/blocks.$blockId.tsx");
    expect(builder).toContain('target={{ kind: "client", clientId, focusBlockId: blockId }}');
    // what's on screen is saved first, and the builder re-reads the program after
    expect(builder).toContain("if (dirty) await save();");
    expect(builder).toContain("hydratedBlockIdRef.current = null;");
    const tpl = read("src/route-pages/_authenticated/admin/program-library_.$templateId.tsx");
    expect(tpl).toContain('target={{ kind: "template", templateId }}');
    expect(tpl).toContain("setReloadTick((t) => t + 1);");
  });

  it("a rebuild hands over to Generate Next Program with the coach's words, never a second generator", () => {
    expect(read("src/components/program-ai/edit-with-ai.tsx")).toContain('to="/admin/client-programs/$clientId/next-program"');
    expect(read("src/routes/_authenticated/admin/client-programs.$clientId.next-program.tsx")).toContain("validateSearch");
    expect(read("src/components/program-intel/generator/workstation.tsx")).toContain('change("coachNotes", prefill.notes.trim().slice(0, 2000))');
  });
});

describe("15. only admins and the client's own coach (backend enforced)", () => {
  it("asking checks the coach on the server, and the database refuses anyone else", () => {
    const fns = read("src/lib/program-ai/program-ai.functions.ts");
    expect(fns).toContain('if (target.kind === "template") throw new Error("Only an admin can edit library templates.")');
    expect(fns).toContain('sb.rpc("is_assigned_coach"');
    expect(MIGRATION).toContain("if not public.program_intel_can_coach(v_uid, v_client) then");
    expect(MIGRATION).toContain("if not coalesce(public.has_role(v_uid, 'admin'::app_role), false) then raise exception 'Only an admin can change library templates'");
    expect(MIGRATION).toContain("revoke all on function public.program_ai_apply(uuid, text[], jsonb) from public, anon;");
    // proposals are readable by admins and that client's coaches only; nobody updates them directly
    expect(MIGRATION).toContain("using ((select public.has_role((select auth.uid()), 'admin'::app_role)) or client_id in (select public.coached_client_ids()));");
    expect(MIGRATION).not.toMatch(/create policy[^;]*program_ai_edits\s+for (update|delete)/);
  });

  it("the worker re-checks the coach before reading anything", () => {
    const w = read("src/lib/program-ai/worker.server.ts");
    expect(w).toContain('admin.rpc("program_intel_can_coach", { _user: edit.created_by, _client: edit.client_id })');
    expect(w).toContain('admin.rpc("has_role", { _user_id: edit.created_by, _role: "admin" })');
  });
});

describe("16. one transaction, nothing applied on a stale proposal", () => {
  it("program_ai_apply locks the workouts, checks them against what the coach saw, writes the restore point, then the rows", () => {
    const at = (s: string) => MIGRATION.indexOf(s);
    expect(at("perform 1 from public.pl_days where id = any(v_touched) order by id for update;")).toBeGreaterThan(0);
    expect(at("hint = 'program_ai_locked'")).toBeGreaterThan(at("for update;"));
    expect(at("hint = 'program_ai_stale'")).toBeGreaterThan(0);
    expect(at("insert into public.pl_program_versions")).toBeLessThan(at("delete from public.pl_exercise_rows where id in"));
    // only whitelisted row columns are ever written
    expect(MIGRATION).toContain("where key = any(v_row_cols)");
  });

  it("Apply refuses refs that point somewhere else now", () => {
    const snap = { blocks: [{ id: "b", ref: "B1", weeks: [{ id: "w", ref: "B1W1", days: [{ id: "d2", ref: "B1W1D1", rows: [{ id: "r9", ref: "B1W1D1E1" }] }] }] }] } as unknown as ProgramSnapshot;
    const c = changeSchema.parse({ id: "c1", title: "x", basis: "requested", ops: [{ op: "update", rows: ["B1W1D1E1"], set: { sets: 3 } }] });
    expect(refsStillMatch(snap, [c], { B1W1D1E1: "r9" })).toBe(true);
    // the workout the coach saw was deleted in the builder: E1 is now another row
    expect(refsStillMatch(snap, [c], { B1W1D1E1: "r1" })).toBe(false);
    expect(refsStillMatch(snap, [c], {})).toBe(false);
  });
});

describe("the AI reasons like the coach asked", () => {
  it("narrow asks stay narrow, every change has a basis, facts aren't invented, locked work is never touched", () => {
    for (const s of [
      "A narrow instruction",
      "changes exactly what it names, everywhere it applies in the editable program, and nothing else",
      '"requested" (the coach asked for it), "data"',
      "Never invent a number, a log, a max, a date or an injury",
      "LOCKED workouts (trained, started, or in the past) stay exactly as they are",
      "A client who keeps missing their 5th day doesn't get another 5-day week",
      "Preserve what works",
    ])
      expect(EDIT_SYSTEM_PROMPT).toContain(s);
  });

  it("the athlete is read whole (Program Intelligence's brief), the catalog keeps exercises below the standard out unless they're already in the program", () => {
    expect(read("src/lib/program-ai/worker.server.ts")).toContain('loadIntelRecords(admin, clientId, { kind: "history" })');
    const list = [
      { id: "1", name: "Landmine Lateral Raise", archived: false },
      { id: "2", name: "Cable Lateral Raise", archived: false },
      { id: "3", name: "Old Press", archived: true },
    ] as any[];
    expect(catalogFrom(list, new Set()).map((e) => e.name)).toEqual(["Cable Lateral Raise"]);
    expect(catalogFrom(list, new Set(["1"])).map((e) => `${e.code} ${e.name} ${e.standard ? "flagged" : ""}`.trim())).toEqual(["X1 Cable Lateral Raise", "X2 Landmine Lateral Raise flagged"]);
  });

  it("training days round-trip between the app's names and the model's", () => {
    expect(toShortDays(["Monday", "Thursday", "Friday"])).toEqual(["mon", "thu", "fri"]);
    expect(toFullDays(["mon", "thu"])).toEqual(["Monday", "Thursday"]);
  });
});
