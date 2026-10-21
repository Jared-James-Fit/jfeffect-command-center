import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { newlyOn, othersOn, peopleLabel, sendToTeamPeople, splitTasks, taskPeople, togglePerson } from "@/lib/tasks";
import { taskSharedPush } from "@/lib/tasks.functions";

const ME = "u-jared";
const FI = "u-fionna";
const VI = "u-vicky";
const sql = readFileSync("supabase/migrations/20261221090000_shared_tasks.sql", "utf8");
const page = readFileSync("src/components/tasks/tasks-page.tsx", "utf8");
const task = (assignees: string[], owner: string | null = null) => ({ owner_user_id: owner, assigned_to: assignees[0] ?? null, assignees });

describe("sending a task shares it", () => {
  it("whoever it's sent to joins the sender on it; the board alone means nobody yet", () => {
    expect(sendToTeamPeople(ME, FI)).toEqual([ME, FI]);
    expect(sendToTeamPeople(ME, ME)).toEqual([ME]);
    expect(sendToTeamPeople(ME, null)).toEqual([]);
  });

  it("a shared task is in My tasks for everyone on it, and on the Team board", () => {
    const shared = { id: "s", ...task([ME, FI]) };
    expect(splitTasks([shared], ME).mine.map((t) => t.id)).toEqual(["s"]);
    expect(splitTasks([shared], FI).mine.map((t) => t.id)).toEqual(["s"]);
    expect(splitTasks([shared], VI).mine).toEqual([]);
    expect(splitTasks([shared], VI).team.map((t) => t.id)).toEqual(["s"]);
  });

  it("each person sees who else is on it", () => {
    expect(othersOn(task([ME, FI]), ME)).toEqual([FI]);
    expect(othersOn(task([ME, FI]), FI)).toEqual([ME]);
    expect(peopleLabel(["Fionna Gaburno"])).toBe("Fionna");
    expect(peopleLabel(["Me", "Fionna Gaburno"])).toBe("Me & Fionna");
    expect(peopleLabel(["Fionna Gaburno", "Vicky Lee", "Marc S"])).toBe("Fionna +2");
    expect(peopleLabel([])).toBe("");
  });

  it("people are added and taken off in order, and only the newly added hear about it", () => {
    expect(togglePerson([ME], FI)).toEqual([ME, FI]);
    expect(togglePerson([ME, FI], ME)).toEqual([FI]);
    expect(newlyOn([ME], [ME, FI], ME)).toEqual([FI]);
    // never yourself
    expect(newlyOn([], [ME], ME)).toEqual([]);
  });

  it("a row from before shared tasks still counts its one assignee; a private task has nobody", () => {
    expect(taskPeople({ owner_user_id: null, assigned_to: FI, assignees: [] })).toEqual([FI]);
    expect(taskPeople({ owner_user_id: null, assigned_to: FI })).toEqual([FI]);
    expect(taskPeople(task([FI], ME))).toEqual([]);
  });

  it("the push says who shared it and opens the task, never what it says", () => {
    expect(taskSharedPush("Jared McIntyre", ["t1"])).toEqual({
      title: "Jared shared a task with you",
      body: "Open Tasks to see it.",
      url: "/admin/content#task=t1",
    });
    expect(taskSharedPush("", ["t1", "t2"]).title).toBe("Your team shared 2 tasks with you");
    expect(taskSharedPush("Jared", ["t1", "t2"]).url).toBe("/admin/content");
  });
});

describe("the database keeps the people on a task straight", () => {
  it("assigned_to is a login, so assigning never fails tasks_assigned_to_fkey again", () => {
    expect(sql).toContain("ADD CONSTRAINT tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL;");
    expect(sql).toContain("ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS assignees uuid[] NOT NULL DEFAULT '{}';");
  });

  it("each person once in the order added, real logins only, nobody on a private task, the first person as assigned_to", () => {
    const fn = sql.slice(sql.indexOf("FUNCTION public.tasks_assignees_sync"));
    expect(fn).toContain("IF NEW.owner_user_id IS NOT NULL THEN\n    NEW.assignees := '{}';");
    expect(fn).toContain("SELECT coalesce(array_agg(d.a ORDER BY d.o), '{}'::uuid[]) INTO v");
    expect(fn).toContain("WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = d.a);");
    expect(fn).toContain("NEW.assigned_to := v[1];");
    expect(sql).toContain("BEFORE INSERT OR UPDATE OF assignees, assigned_to, owner_user_id ON public.tasks");
    // a media manager reads every task they're on
    expect(sql).toContain("(SELECT auth.uid()) = ANY (assignees)");
  });
});

describe("the task page", () => {
  it("shows who else is on a shared task, on its row and when it's open", () => {
    expect(page).toContain('<SharedWith key="with" names={others} lead="with" />');
    expect(page).toContain("Shared · {peopleLabel(names)}");
    expect(page).toContain("whoOf={(t) => peopleLabel(namesOf(t, { others: board === \"mine\" }))}");
  });

  it("Send to team shares it with someone (or puts it on the board); People ticks as many as it's for", () => {
    expect(page).toContain("const people = sendToTeamPeople(me, m?.user_id ?? null);");
    expect(page).toContain("Team board, no one yet");
    expect(page).toContain("<DropdownMenuCheckboxItem");
    expect(page).toContain("onSelect={(e) => e.preventDefault()}");
  });

  it("says it worked only once it saved, and tells whoever was just added", () => {
    expect(page).toContain("if (!(await patchOne(t, { owner_user_id: null, assignees: people }))) return;\n    announce([t.id], people);");
    expect(page).toContain("if (await patchOne(t, { assignees: after })) announce([t.id], newlyOn(before, after, me));");
    expect(page).toContain("void notifyTaskSharedFn({ data: { taskIds: ids, to: people } }).catch(() => {});");
    // a push opens the task on the board that has it
    expect(page).toContain('const id = window.location.hash.match(/(?:^#|&)task=([0-9a-f-]{36})/i)?.[1];');
  });
});
