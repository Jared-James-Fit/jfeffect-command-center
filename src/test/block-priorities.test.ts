import { describe, expect, it } from "vitest";
import { weekPriorities } from "@/lib/block-priorities";

const row = (id: string, label: string | null, name = "Competition Squat", sort_order = 0) => ({ id, label, sort_order, exercises: { name } });
const day = (id: string, date: string, rows: ReturnType<typeof row>[]) => ({ id, date: new Date(`${date}T12:00:00`), dayIndex: 1, rows });
const by = (rows: ReturnType<typeof row>[]) => (r: { id?: string | null }) => rows.find((x) => x.id === r.id)?.label;

describe("the week's priorities, one line per training day", () => {
  it("folds back-offs into their top set, never lists a label twice, and leaves accessory roles out", () => {
    const mon = [row("a", "Primary Squat", "Competition Squat", 0), row("b", "Primary Squat Backoff", "Competition Squat", 1), row("c", "Quaternary Squat", "Front Squat", 2), row("d", "Assistance", "Leg Press", 3)];
    const tue = [row("e", "Lats", "Lat Pulldown"), row("f", "Lats", "Chest Supported Row", 1), row("g", "Primary Deadlift", "Competition Deadlift", 2)];
    const all = [...mon, ...tue];
    const out = weekPriorities([day("tue", "2026-11-10", tue), day("mon", "2026-11-09", mon)], by(all));
    expect(out).toEqual([
      { dayId: "mon", dayLabel: "Mon", items: ["Primary Squat + back-offs", "Quaternary Squat"] },
      { dayId: "tue", dayLabel: "Tue", items: ["Primary Deadlift"] },
    ]);
  });

  it("a bare rank from the exercise's category reads with its name, ranked first to last", () => {
    const rows = [row("a", "Secondary", "2ct Paused Bench", 0), row("b", "Primary", "Competition Bench", 1)];
    expect(weekPriorities([day("d", "2026-11-12", rows)], by(rows))[0].items).toEqual(["Primary · Competition Bench", "Secondary · 2ct Paused Bench"]);
  });

  it("a day with nothing ranked has no line", () => {
    const rows = [row("a", "Assistance", "Curl")];
    expect(weekPriorities([day("d", "2026-11-12", rows)], by(rows))).toEqual([]);
  });
});
