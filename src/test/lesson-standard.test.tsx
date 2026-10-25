import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LessonVisualArt } from "@/components/community/lesson-visuals";

const read = (p: string) => readFileSync(p, "utf8");

describe("the educational post standard", () => {
  it("is written down and the lesson rule points to it", () => {
    const doc = read("docs/EDUCATIONAL_POSTS.md");
    expect(doc).toContain("Research → Question → Analyze the mechanics → Consider competing explanations →");
    expect(doc).toContain("Separate evidence from interpretation");
    expect(doc).toContain("up to 1200 characters");
    expect(read("AGENTS.md")).toContain("docs/EDUCATIONAL_POSTS.md");
  });

  it("draws the sticking region the way the bar's physics has it: fastest point to slowest", () => {
    const win = renderToStaticMarkup(<LessonVisualArt visual={{ kind: "sticking_point", lift: "bench", variant: "window" }} tone="dark" />);
    expect(win).toContain("push &lt; bar weight");
    expect(win).toContain("fastest");
    expect(win).toContain("slowest");
    // the shaded window starts at the fastest dot and ends at the slowest one
    const rect = /<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/.exec(win)!;
    const dots = [...win.matchAll(/<circle cx="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(Number(rect[1])).toBeCloseTo(dots[0], 0);
    expect(Number(rect[1]) + Number(rect[2])).toBeCloseTo(dots[1], 0);

    const plain = renderToStaticMarkup(<LessonVisualArt visual={{ kind: "sticking_point", lift: "bench" }} tone="dark" />);
    expect(plain).toContain("sticking region");
    expect(/<rect x="([\d.]+)"/.exec(plain)![1]).toBe(rect[1]);
  });
});

describe("the third library pass (docs/EDUCATIONAL_POSTS.md)", async () => {
  const { LESSON_VISUAL_KINDS, cleanSticker, hookLine, safeRefUrl } = await import("@/lib/lessons");
  const sql = read("supabase/migrations/20261231110000_lessons_think_deeper.sql");
  const rows: { body: string; data: any }[] = [];
  const re = /\$l\$([\s\S]*?)\$l\$, \$j\$([\s\S]*?)\$j\$::jsonb/g;
  for (let m = re.exec(sql); m; m = re.exec(sql)) rows.push({ body: m[1], data: JSON.parse(m[2]) });

  it("rewrites the bench lesson and the next eight planned, in the coach's voice", () => {
    expect(rows.map((r) => r.data.key).sort()).toEqual([
      "bar-over-midfoot", "bench-midrange-position", "force-velocity-intent", "methods-unilateral-work",
      "recovery-same-muscle", "reset-sleep", "squat-torso-angle-max", "training-log-review", "truth-motivation",
    ]);
    for (const { body, data } of rows) {
      expect(body.length, data.key).toBeLessThanOrEqual(1200);
      expect(body, data.key).not.toMatch(/[—–;]|\*\*|^#/m);
      expect(hookLine(body).length, data.key).toBeLessThanOrEqual(90);
      // studies by year, never by author, in the post
      expect(body, data.key).not.toMatch(/et al|&amp;|\(\w+ (&|and) \w+/);
      // interpretation or hypothesis is said as such
      expect(body, data.key).toMatch(/Best read|My take|My bet|My read|My test|My rule/);
      expect(data.title, data.key).toBeTruthy();
      expect(data.title.length, data.key).toBeLessThanOrEqual(48);
      for (const r of data.refs ?? []) if (r.url) expect(safeRefUrl(r.url), `${data.key}: ${r.url}`).not.toBeNull();
      if (data.visual) expect(LESSON_VISUAL_KINDS).toContain(data.visual.kind);
      if (data.story) expect(cleanSticker(data.story).ok, data.key).toBe(true);
    }
    const truth = rows.find((r) => r.data.key === "truth-motivation")!.data.visual;
    expect(truth.kind).toBe("truth");
    expect(truth.belief.length).toBeLessThanOrEqual(60);
    expect(truth.truth.length).toBeLessThanOrEqual(90);
    const reset = rows.find((r) => r.data.key === "reset-sleep")!.data.visual;
    expect(reset.kind).toBe("reset");
    for (const it of reset.items) expect(it.length).toBeLessThanOrEqual(40);
  });

  it("the bench lesson questions the 1989 study and draws the window, and nothing the coach changed is overwritten", () => {
    const bench = rows.find((r) => r.data.key === "bench-midrange-position")!;
    expect(bench.body).toContain("The bar only slows when your push drops below its weight.");
    expect(bench.body).toContain("only the first used powerlifters");
    expect(bench.data.visual).toEqual({ kind: "sticking_point", lift: "bench", variant: "window" });
    expect(bench.data.refs.map((r: any) => r.label).join(" ")).toContain("van den Tillaar & Ettema 2013");
    expect(sql).toContain("md5(p.caption) = v.seeded_md5");
    expect(sql).toContain("md5(i.body) = v.seeded_md5");
    expect(sql).toContain("AND coalesce(i.use_count, 0) = 0;");
    // Nov 2 moves off the old sticking-points lesson only while it's still planned as that
    expect(sql).toContain("WHERE day = '2026-11-02' AND status = 'planned' AND item_id = '4d198735-569d-4d3b-a239-3f7771761947'");
  });
});
