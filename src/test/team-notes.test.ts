import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  groupKey, groupLabel, groupTeamNotes, membersAfterPick, othersIn, rememberGroup, shareTargets, type TeamNote,
} from "@/lib/team-notes";
import { teamNoteSharedPush } from "@/lib/team-notes.functions";
import { canTakeBack } from "@/components/tasks/team-notes";

const ME = "u-jared";
const FI = "u-fionna";
const YA = "u-yannick";
const ST = "u-steph";

let seq = 0;
const note = (members: string[], updated: string, extra: Partial<TeamNote> = {}): TeamNote => ({
  id: `n${++seq}`, members, title: "t", body: "", created_by: members[0] ?? null, updated_by: members[0] ?? null,
  created_at: updated, updated_at: updated, ...extra,
});

const sql = readFileSync("supabase/migrations/20270327090000_team_notes.sql", "utf8");
const panel = readFileSync("src/components/tasks/quick-notes.tsx", "utf8");
const team = readFileSync("src/components/tasks/team-notes.tsx", "utf8");
const page = readFileSync("src/components/tasks/tasks-page.tsx", "utf8");

describe("team notes are grouped by who they're with", () => {
  it("the same people make one group whatever order they were added in, me aside", () => {
    expect(groupKey([FI, YA])).toBe(groupKey([YA, FI]));
    expect(groupKey([FI, FI])).toBe(groupKey([FI]));
    expect(othersIn([ME, FI], ME)).toEqual([FI]);
    // Fionna sees a note Jared shared with her as Jared's group
    expect(othersIn([ME, FI], FI)).toEqual([ME]);
  });

  it("one card per group, the group edited most recently first, its notes newest first", () => {
    const a = note([ME, FI], "2026-11-10T10:00:00Z");
    const b = note([FI, ME], "2026-11-14T10:00:00Z");
    const c = note([ME, FI, YA], "2026-11-12T10:00:00Z");
    const groups = groupTeamNotes([a, b, c], ME);
    expect(groups.map((g) => g.others)).toEqual([[FI], [FI, YA]]);
    expect(groups[0].notes.map((n) => n.id)).toEqual([b.id, a.id]);
  });

  it("names a group in plain words", () => {
    expect(groupLabel(["Fionna Gaburno"])).toBe("Fionna");
    expect(groupLabel(["Fionna Gaburno", "Yannick X"])).toBe("Fionna & Yannick");
    expect(groupLabel(["Fionna", "Yannick", "Steph"])).toBe("Fionna, Yannick & Steph");
    expect(groupLabel(["Fionna", "Yannick", "Steph", "Marc"])).toBe("Fionna, Yannick +2");
    expect(groupLabel([])).toBe("Only you");
  });
});

describe("sharing again with the same group is one tap", () => {
  it("offers the group shared with last first, then groups with notes, then each teammate alone", () => {
    const notes = [note([ME, FI, YA], "2026-11-14T10:00:00Z")];
    expect(shareTargets({ remembered: [[ST, FI]], notes, teamIds: [ME, FI, YA, ST], me: ME, limit: 5 }))
      .toEqual([[ST, FI], [FI, YA], [FI], [YA], [ST]]);
  });

  it("never offers an empty group, a group twice, me, or someone who left the team", () => {
    const targets = shareTargets({
      remembered: [[ME], [FI, ME], [FI], ["u-gone", FI]],
      notes: [note([ME, FI], "2026-11-14T10:00:00Z")],
      teamIds: [ME, FI],
      me: ME,
    });
    expect(targets).toEqual([[FI]]);
  });

  it("keeps at most a few, the newest share first", () => {
    expect(shareTargets({ remembered: [], notes: [], teamIds: [ME, FI, YA, ST], me: ME })).toHaveLength(3);
    expect(rememberGroup([[FI], [FI, YA]], [YA, FI])).toEqual([[YA, FI], [FI]]);
    expect(rememberGroup([[FI]], [])).toEqual([[FI]]);
  });

  it("changing the people keeps me on it and everyone's order", () => {
    expect(membersAfterPick([FI, ME, YA], [YA, ST], ME)).toEqual([ME, YA, ST]);
    expect(membersAfterPick([ME, FI], [], ME)).toEqual([ME]);
    expect(membersAfterPick([FI], [FI], ME)).toEqual([ME, FI]);
  });
});

describe("remove from team", () => {
  it("only whoever shared it takes it back; anyone else leaves it", () => {
    expect(canTakeBack({ created_by: ME, members: [ME, FI] }, ME)).toBe(true);
    expect(canTakeBack({ created_by: ME, members: [ME, FI] }, FI)).toBe(false);
    // the sharer left the team: anyone on it can take it
    expect(canTakeBack({ created_by: "u-gone", members: [FI] }, FI)).toBe(true);
    expect(canTakeBack({ created_by: null, members: [FI] }, FI)).toBe(true);
  });

  it("a team note goes back into your Quick notes with Undo; a team task back to your private tasks with Undo", () => {
    expect(team).toContain('<Undo2 className="mr-2 h-4 w-4" />Remove from team');
    expect(team).toContain('toast.success("Moved to your Quick notes"');
    expect(page).toContain("data-task-remove-from-team");
    expect(page).toContain('toast.success("Removed from the team"');
    expect(page).toContain("{ owner_user_id: null, assignees: before }");
    expect(page).toContain("Move to team notes");
  });
});

describe("the Tasks page", () => {
  it("lists Team notes right under Quick notes, and a quick note's menu shares it in one tap", () => {
    expect(panel).toContain("<TeamNotesSection");
    expect(panel).toContain("<MenuLabel>Share with team</MenuLabel>");
    expect(panel).toContain("onClick={() => void shareToTeam(list(), g)} data-share-group");
    // Choose people… can still make it a task, for several people at once
    expect(panel).toContain('else void moveToMatrix(list, { quadrant, team: true, people });');
    expect(page).toContain("[...new Set([me, ...input.people].filter((u): u is string => !!u))]");
  });

  it("a shared note's push opens it and never says what it says", () => {
    expect(teamNoteSharedPush("Jared McIntyre", ["n1"])).toEqual({
      title: "Jared shared a note with you",
      body: "It's in Team notes on your Tasks.",
      url: "/admin/content#note=n1",
    });
    expect(teamNoteSharedPush("", ["n1", "n2"]).title).toBe("Your team shared 2 notes with you");
    expect(team).toContain("const id = window.location.hash.match(/(?:^#|&)note=([0-9a-f-]{36})/i)?.[1];");
  });
});

describe("the database decides who sees a team note", () => {
  it("members only, each once, teammates only", () => {
    expect(sql).toContain("USING ((SELECT auth.uid()) = ANY (members) AND (SELECT public.works_task_board((SELECT auth.uid()))));");
    expect(sql).toContain("WHERE m.u IS NOT NULL AND public.works_task_board(m.u)");
    expect(sql).toContain("REVOKE ALL ON public.team_notes FROM anon;");
  });

  it("an edit always keeps the editor on it; leaving is its own function", () => {
    expect(sql).toContain("WITH CHECK ((SELECT auth.uid()) = ANY (members));");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.team_note_leave(_id uuid)");
  });

  it("only a change to the words moves it up; people changes keep its place", () => {
    expect(sql).toContain("IF NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body THEN");
    expect(sql).toContain("NEW.updated_at := OLD.updated_at;");
  });

  it("is live for everyone on it", () => {
    expect(sql).toContain("ALTER PUBLICATION supabase_realtime ADD TABLE public.team_notes;");
  });
});
