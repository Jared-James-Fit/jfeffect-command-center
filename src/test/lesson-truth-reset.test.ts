import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LESSON_TRACK, LESSON_TRACKS, cleanSticker, extraLesson, hookLine, safeRefUrl } from "@/lib/lessons";
import { LessonVisualArt } from "@/components/community/lesson-visuals";

const sql = readFileSync("supabase/migrations/20261225090000_lesson_truth_reset.sql", "utf8");

/** Body ($l$…$l$) and data ($j$…$j$) of each lesson row in the migration. */
function lessonRows(src: string) {
  const rows: { body: string; data: any }[] = [];
  const re = /\$l\$([\s\S]*?)\$l\$, \$j\$([\s\S]*?)\$j\$::jsonb/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) rows.push({ body: m[1], data: JSON.parse(m[2]) });
  return rows;
}

const lib = lessonRows(sql);
const truths = lib.filter((l) => l.data.track === "truth");
const resets = lib.filter((l) => l.data.track === "reset");

describe("Wednesday's uncomfortable truth and Sunday's reset", () => {
  it("a lesson every day: Wed truth, Sun reset, the other five unchanged", () => {
    expect(LESSON_TRACKS.map((t) => LESSON_TRACK[t].isoDay)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(LESSON_TRACK.truth).toMatchObject({ name: "Uncomfortable truth", day: "Wed" });
    expect(LESSON_TRACK.reset).toMatchObject({ name: "Sunday reset", day: "Sun" });
    expect(sql).toContain("WHEN 1 THEN 'strength' WHEN 2 THEN 'hypertrophy' WHEN 3 THEN 'truth' WHEN 4 THEN 'methods'");
    expect(sql).toContain("WHEN 5 THEN 'mind' WHEN 6 THEN 'fix' WHEN 7 THEN 'reset' END");
    expect(sql).toContain("CHECK (track IN ('strength', 'hypertrophy', 'truth', 'methods', 'mind', 'fix', 'reset'))");
    // saving a library item and the planner's overview accept the new days, whatever version is live
    expect(sql).toContain("v_new text := $q$'strength', 'hypertrophy', 'truth', 'methods', 'mind', 'fix', 'reset'$q$;");
    expect(sql).toContain("IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION 'No track list in %', v_fn; END IF;");
  });

  it("13 of each, unique keys, inserted once per key so the coach's edits stay his", () => {
    expect(truths).toHaveLength(13);
    expect(resets).toHaveLength(13);
    expect(new Set(lib.map((l) => l.data.key)).size).toBe(26);
    for (const { data } of truths) expect(data.key.startsWith("truth-"), data.key).toBe(true);
    for (const { data } of resets) expect(data.key.startsWith("reset-"), data.key).toBe(true);
    expect(sql).toContain("ON CONFLICT ((data->>'key')) WHERE series = 'lesson' DO NOTHING;");
  });

  it("reads like the coach: sentence case, no dashes, semicolons, markdown or never-say words, short enough to read", () => {
    const banned = ["navigating", "it's clear that", "solid win", "momentum", "journey", "dial in", "a strong start", "keep it up", "significantly", "metabolic flexibility", "ensure", "crucial", "optimal", "prioritize", " fr ", "delve", "game-changer"];
    for (const { body, data } of lib) {
      expect(body, data.key).not.toMatch(/[—–;]|\*\*|^#/m);
      for (const w of banned) expect(` ${body.toLowerCase()} `, `${data.key}: ${w}`).not.toContain(w);
      expect(body.length, data.key).toBeLessThanOrEqual(900);
      expect(hookLine(body).length, data.key).toBeLessThanOrEqual(90);
      expect(body[0], data.key).toMatch(/[A-Z]/);
      expect(body, data.key).not.toMatch(/& co\b/);
    }
    // a Sunday reset says what it is up front
    for (const { body, data } of resets) expect(hookLine(body).startsWith("Sunday reset. "), data.key).toBe(true);
  });

  it("names a study only with its source kept for the coach, on a real page", () => {
    for (const { body, data } of lib) {
      if (/\b(19|20)\d\d (study|review|trial|survey|pilot|meta-analysis)\b/.test(body)) expect(data.refs.length, data.key).toBeGreaterThan(0);
      for (const r of data.refs) expect(safeRefUrl(r.url), `${data.key}: ${r.url}`).not.toBeNull();
    }
    const refs = (k: string) => lib.find((l) => l.data.key === k)!.data.refs.map((r: any) => r.url);
    expect(refs("truth-soreness")).toEqual(["https://doi.org/10.1519/SSC.0b013e3182a61820"]);
    expect(refs("truth-grinding")).toEqual(["https://pubmed.ncbi.nlm.nih.gov/33497853/"]);
    expect(refs("truth-cardio")).toEqual(["https://pubmed.ncbi.nlm.nih.gov/34757594/"]);
    expect(refs("truth-spotlight")).toEqual(["https://pubmed.ncbi.nlm.nih.gov/10707330/"]);
    expect(refs("truth-missed-day")).toEqual(["https://doi.org/10.1002/ejsp.674"]);
    expect(refs("truth-protein-clean")).toEqual(["https://pubmed.ncbi.nlm.nih.gov/28698222/"]);
    expect(refs("reset-if-then")).toEqual(["https://doi.org/10.1016/S0065-2601(06)38002-1"]);
  });

  it("every one has its card (belief struck out → truth, or the week's three things) and a sticker the app accepts", () => {
    for (const { data } of truths) {
      expect(data.visual.kind, data.key).toBe("truth");
      expect(data.visual.belief.length, data.key).toBeLessThanOrEqual(60);
      expect(data.visual.truth.length, data.key).toBeLessThanOrEqual(90);
    }
    for (const { data } of resets) {
      expect(data.visual.kind, data.key).toBe("reset");
      expect(data.visual.items, data.key).toHaveLength(3);
      for (const i of data.visual.items) expect(i.length, `${data.key}: ${i}`).toBeLessThanOrEqual(36);
    }
    for (const { data } of lib) expect(cleanSticker(data.story).ok, data.key).toBe(true);
  });

  it("plays in the feed and the story from the post itself", () => {
    const { data } = truths.find((l) => l.data.key === "truth-soreness")!;
    const l = extraLesson({ series: "lesson", series_extra: data } as any)!;
    expect(l.track).toBe("truth");
    const html = renderToStaticMarkup(createElement(LessonVisualArt, { visual: l.visual!, tone: "dark" }));
    expect(html).toContain("data-truth-card");
    expect(html).toContain("If I&#x27;m not sore, it didn&#x27;t work");
    expect(html).toContain("line-through");
    const reset = extraLesson({ series: "lesson", series_extra: resets[0].data } as any)!;
    const r = renderToStaticMarkup(createElement(LessonVisualArt, { visual: reset.visual! }));
    expect(r).toContain("data-reset-card");
    for (const i of resets[0].data.visual.items) expect(r).toContain(i.replace(/'/g, "&#x27;"));
    // a card with nothing to say draws nothing
    expect(renderToStaticMarkup(createElement(LessonVisualArt, { visual: { kind: "truth", belief: " ", truth: "x" } }))).toBe("");
    expect(renderToStaticMarkup(createElement(LessonVisualArt, { visual: { kind: "reset", items: [] } }))).toBe("");
  });
});
