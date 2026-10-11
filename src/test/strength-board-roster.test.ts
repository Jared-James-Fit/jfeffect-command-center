import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeAllRow, unrankedFor, type RosterPerson } from "@/lib/strength-board";

const person = (key: string, name: string, sex: "male" | "female" | null, alumni = false): RosterPerson =>
  ({ key, display_name: name, avatar_url: null, is_me: false, is_coach: false, is_alumni: alumni, sex });
const row = (person: string, lift: string, kg: number, sex: string | null, p4p: number | null, abs: number | null, all: number, bw = 80) =>
  normalizeAllRow({ person, client_id: person.slice(2), display_name: person, sex, lift, kg, bw_kg: bw, bw_multiple: kg / bw, p4p_rank: p4p, abs_rank: abs, all_rank: all, lifted_on: "2026-10-01", source: "training" });

describe("Hall of Strength: everyone, ranked or not", () => {
  const rows = [
    row("c:jared", "total", 662, "male", 1, 1, 1), row("c:jared", "squat", 250, "male", 1, 1, 1),
    row("c:jared", "bench", 160, "male", 1, 1, 1), row("c:jared", "deadlift", 252, "male", 1, 1, 1),
    // Nicolas: squat + bench, no Men/Women set
    row("c:nico", "squat", 180, null, 2, null, 2), row("c:nico", "bench", 120, null, 2, null, 2),
  ];
  const roster = [person("c:jared", "Jared M", "male"), person("c:nico", "Nicolas G", null), person("c:nicole", "Nicole Y", "female"), person("c:old", "Bob", null, true)];
  it("lists who isn't on the board and what's missing; Men lists men and the unset", () => {
    const men = unrankedFor(roster, rows, "p4p", "total", "male");
    expect(men.map((p) => [p.display_name, p.reason])).toEqual([
      ["Nicolas G", "Needs a deadlift for a total"],
      ["Bob", "No lifts logged yet"],
    ]);
    expect(unrankedFor(roster, rows, "p4p", "squat", "male").find((p) => p.key === "c:nico")?.reason).toBe("Men or Women not set");
    expect(unrankedFor(roster, rows, "p4p", "squat", "all").some((p) => p.key === "c:nico")).toBe(false);
    expect(unrankedFor(roster, rows, "p4p", "total", "female").map((p) => p.display_name)).toEqual(["Nicolas G", "Nicole Y", "Bob"]);
  });
  it("the sheet shows the Not ranked yet list on the All-time Hall", () => {
    const ui = readFileSync(new URL("../components/portal/strength-board.tsx", import.meta.url), "utf8");
    expect(ui).toContain('db.rpc("get_strength_board_roster"');
    expect(ui).toContain("{unranked.length > 0 && <NotRankedYet people={unranked} />}");
  });
});
