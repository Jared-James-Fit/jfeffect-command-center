import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  LESSON_VISUAL_KINDS, answerSticker, cleanSticker, coachClock, coachInstant, extraLesson, hookLine, lessonArtPrompt, lessonKicker,
  lessonStatusLabel, missingLevels, needsReview, safeRefUrl, stickerCountLabel, stickerPercents, type LessonPlanRow, type PostSticker,
} from "@/lib/lessons";
import { banister } from "@/components/community/lesson-visuals";
import { groupWeeks } from "@/components/community/coach-lessons";
import { lessonReminder } from "@/lib/lesson-reminders.server";

const read = (f: string) => readFileSync(f, "utf8");
const sql = read("supabase/migrations/20261129110000_community_lessons.sql");
const seed = read("supabase/migrations/20261129111000_community_lessons_library.sql");

/** The library as seeded: body ($l$…$l$) and data ($j$…$j$) of each lesson. */
function library() {
  const rows: { body: string; data: any }[] = [];
  const re = /\$l\$([\s\S]*?)\$l\$, \$j\$([\s\S]*?)\$j\$::jsonb/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(seed))) rows.push({ body: m[1], data: JSON.parse(m[2]) });
  return rows;
}

describe("the lesson library", () => {
  const lib = library();
  it("has 77 lessons with unique keys, across the five lesson days", () => {
    expect(lib).toHaveLength(77);
    expect(new Set(lib.map((l) => l.data.key)).size).toBe(77);
    const by = (t: string) => lib.filter((l) => l.data.track === t).length;
    expect([by("strength"), by("hypertrophy"), by("methods"), by("mind"), by("fix")]).toEqual([13, 13, 11, 13, 27]);
  });

  it("troubleshooting covers every lift at every level (3 each), so every month can get all three levels", () => {
    const fix = lib.filter((l) => l.data.track === "fix");
    for (const lift of ["squat", "bench", "deadlift"])
      for (const level of ["beginner", "advanced", "elite"])
        expect(fix.filter((l) => l.data.lift === lift && l.data.level === level)).toHaveLength(3);
    // the three the coach asked for, per lift
    for (const k of ["squat-heels-lift", "squat-good-morning", "squat-torso-angle-max", "bench-touch-point-inconsistent", "bench-midrange-position", "bench-touch-elbows-build", "deadlift-hips-shoot-up", "deadlift-bar-drift-forward", "deadlift-start-efficiency"])
      expect(fix.some((l) => l.data.key === k)).toBe(true);
  });

  it("reads like the coach: no em dashes, semicolons, markdown or never-say words, and short enough to read", () => {
    const banned = ["navigating", "it's clear that", "solid win", "momentum", "journey", "dial in", "a strong start", "keep it up", "significantly", "metabolic flexibility", "ensure", "crucial", "optimal", "prioritize", " fr ", "delve", "game-changer"];
    for (const { body, data } of lib) {
      expect(body, data.key).not.toMatch(/[—–;]|\*\*|^#/m);
      for (const w of banned) expect(` ${body.toLowerCase()} `, `${data.key}: ${w}`).not.toContain(w);
      expect(body.length, data.key).toBeLessThanOrEqual(900);
      // the first line is the hook (it leads the story)
      expect(hookLine(body).length, data.key).toBeLessThanOrEqual(90);
    }
  });

  it("only links real pages, draws only diagrams the app has, and every sticker is one the app accepts", () => {
    for (const { data } of lib) {
      for (const r of data.refs ?? []) {
        expect(r.label.length).toBeGreaterThan(5);
        if (r.url) expect(safeRefUrl(r.url), `${data.key}: ${r.url}`).not.toBeNull();
      }
      if (data.visual) expect(LESSON_VISUAL_KINDS).toContain(data.visual.kind);
      if (data.story) expect(cleanSticker(data.story).ok, data.key).toBe(true);
    }
    // the coach's three story questions are in there, tagged so answers steer the plan
    const stories = lib.map((l) => l.data.story).filter(Boolean);
    expect(stories.some((s) => s.q.includes("hips shooting up first on deadlifts"))).toBe(true);
    expect(stories.some((s) => s.q.includes("biggest bench issue") && s.options.map((o: any) => o.tag).join() === "bench-off-chest,bench-midrange,bench-lockout")).toBe(true);
    expect(stories.some((s) => s.q.includes("watch your heavy singles back"))).toBe(true);
  });

  it("is inserted once per key: a lesson the coach has edited is never overwritten", () => {
    expect(seed).toContain("ON CONFLICT ((data->>'key')) WHERE series = 'lesson' DO NOTHING;");
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS community_series_items_lesson_key_uidx");
  });
});

describe("the plan and how lessons go out", () => {
  it("keeps the week at 7 posts: lessons Mon/Tue/Thu/Fri/Sat, Wins and Recap keep theirs", () => {
    expect(sql).toContain("WHEN 1 THEN 'strength' WHEN 2 THEN 'hypertrophy' WHEN 4 THEN 'methods' WHEN 5 THEN 'mind' WHEN 6 THEN 'fix' END");
    expect(sql).toContain("IF _series IS NULL AND v_series NOT IN (''wednesday_wins'', ''sunday_recap'') THEN RETURN jsonb_build_object(''status'', ''lesson_day''); END IF;");
  });

  it("reviews first: nothing posts unless it's approved, or the coach let lessons run on their own", () => {
    expect(sql).toContain("lesson_mode text NOT NULL DEFAULT 'review'");
    expect(sql).toContain("AND (p.status = 'approved' OR v_settings.lesson_mode = 'auto')");
    // a missed one isn't used up; a failure is retried then flagged, never doubled
    expect(sql).toContain("SET status = 'missed'");
    expect(sql).toContain("status = CASE WHEN attempts + 1 >= 3 THEN 'failed' ELSE status END");
    expect(sql).toContain("INSERT INTO public.community_series_runs (series_key, series, item_id) VALUES (v_key, 'lesson', v_item.id) ON CONFLICT (series_key) DO NOTHING;");
    expect(sql).toContain("cron.schedule('community-lessons', '*/15 * * * *', 'select public.community_publish_lessons();')");
  });

  it("every month gets a beginner, an advanced and an elite technique fix, and the lift rotates", () => {
    expect(sql).toContain("v_must := coalesce(array_length(v_need, 1), 0) >= greatest(v_left, 1);");
    expect(sql).toContain("(_track = 'fix' AND i.data->>'lift' IS DISTINCT FROM v_last_lift) DESC");
    // what the crew says it wants (tagged poll answers) nudges the order, never decides alone
    expect(sql).toContain("(SELECT coalesce(sum(x.n), 0) FROM interest x WHERE coalesce(i.data->'tags', '[]'::jsonb) ? x.tag) DESC");
  });

  it("posts at the hour the crew is around, learned from views (coaches left out), 5pm until there's enough", () => {
    expect(sql).toContain("'learned', (SELECT count(*) FROM v) >= 150,");
    expect(sql).toContain("ELSE '17:00' END)");
    expect(sql).toContain("AND pv.viewer_user_id NOT IN (SELECT user_id FROM staff WHERE user_id IS NOT NULL)");
  });

  it("crew data posts only with 5+ people on each side, once every 4 weeks, worded as a pattern not proof", () => {
    expect(sql).toContain("IF v_a < 5 OR v_b < 5 OR v_x IS NULL OR v_y IS NULL THEN RETURN NULL; END IF;");
    expect(sql).toContain("p.created_at > now() - interval '27 days'");
    expect(sql).toContain("thats a pattern not proof");
    expect(sql).not.toContain("probably not magic, its practice");
  });

  it("is staff-only, and the tables are only reachable through the functions", () => {
    expect(sql).toContain("ALTER TABLE public.community_lesson_plan ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain("ALTER TABLE public.community_sticker_answers ENABLE ROW LEVEL SECURITY;");
    expect(sql).not.toContain("CREATE POLICY");
    expect(sql).toContain("IF uid IS NULL OR NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.community_lesson_post(uuid, boolean) FROM PUBLIC, anon, authenticated;");
  });

  it("lists the next two weeks by week, and says what each lesson needs", () => {
    const row = (day: string, status: LessonPlanRow["status"], item = true) => ({ id: day, day, status, item: item ? ({} as any) : null, posted_as: null }) as unknown as LessonPlanRow;
    const weeks = groupWeeks([row("2026-10-15", "planned"), row("2026-10-17", "approved"), row("2026-10-19", "planned"), row("2026-10-27", "planned")], "2026-10-15");
    expect(weeks.map((w) => [w.label, w.rows.length])).toEqual([["This week", 2], ["Next week", 1], ["Week of Oct 26", 1]]);
    expect(lessonStatusLabel(row("x", "planned"), "review")).toBe("Needs your OK");
    expect(lessonStatusLabel(row("x", "planned"), "auto")).toBe("Goes out on its own");
    expect(lessonStatusLabel(row("x", "skipped", false), "review")).toBe("Cleared");
    expect(needsReview([row("a", "planned"), row("b", "approved"), row("c", "planned", false)], "review").map((r) => r.id)).toEqual(["a"]);
    expect(needsReview([row("a", "planned")], "auto")).toEqual([]);
    expect(missingLevels({ beginner: 1, advanced: 0, elite: 2 })).toEqual(["advanced"]);
  });

  it("plans in Winnipeg time, daylight saving included", () => {
    expect(coachInstant("2026-10-15", "17:00")).toBe("2026-10-15T22:00:00.000Z"); // CDT
    expect(coachInstant("2026-11-10", "17:00")).toBe("2026-11-10T23:00:00.000Z"); // CST
    expect(coachClock("2026-11-10T23:00:00.000Z")).toEqual({ date: "2026-11-10", time: "17:00" });
  });

  it("nudges the coach once, the day before, only while he's reviewing", () => {
    expect(lessonReminder([{ id: "a", day: "2026-10-16", post_at: "2026-10-16T22:00:00Z", title: "Self-talk that actually helps", reminded_at: null }], Date.parse("2026-10-15T23:00:00Z"))?.title).toBe(
      "📚 Tomorrow's lesson needs your OK",
    );
    expect(lessonReminder([{ id: "a", day: "2026-10-16", post_at: "2026-10-16T22:00:00Z", title: "x", reminded_at: "2026-10-15T23:00:00Z" }])).toBeNull();
    expect(sql).toContain("WHERE s.lesson_mode = 'review' AND NOT coalesce(s.paused, false)");
    expect(read("src/routes/api/public/hooks/birthday-notifications.ts")).toContain('import("@/lib/lesson-reminders.server")');
  });
});

describe("a lesson in the feed and the story", () => {
  const post = { series: "lesson", series_extra: { track: "fix", title: "Heels coming up", level: "beginner", lift: "squat", visual: { kind: "bar_path", lift: "squat", fault: "forward" }, refs: [{ label: "x 2017", url: "javascript:alert(1)" }] } } as any;
  it("reads its card data defensively", () => {
    const l = extraLesson(post)!;
    expect(lessonKicker(l)).toBe("Technique fix · Squat · Beginner");
    expect(l.visual?.kind).toBe("bar_path");
    expect(extraLesson({ series: "lesson", series_extra: { track: "nope", title: "x" } } as any)).toBeNull();
    expect(extraLesson({ series: "holiday", series_extra: post.series_extra } as any)).toBeNull();
    expect(safeRefUrl("javascript:alert(1)")).toBeNull();
    expect(safeRefUrl("http://pubmed.ncbi.nlm.nih.gov/1")).toBeNull();
    expect(safeRefUrl("https://pubmed.ncbi.nlm.nih.gov/1/")).toBe("https://pubmed.ncbi.nlm.nih.gov/1/");
  });

  it("keeps it a lesson, not an instruction, on every card", () => {
    expect(read("src/components/community/lesson-card.tsx")).toContain("Good to know, not a change to your program. Big technique changes, ask {first} first.");
  });

  it("plays as a lesson in stories (title, diagram, hook), with the sticker above the reply bar", () => {
    const stories = read("src/components/community/crew-stories.tsx");
    expect(stories).toContain('if (post.series === "lesson") return <LessonStoryFrame post={post} />;');
    expect(stories).toContain('<div className="absolute inset-x-0 z-40" style={{ bottom: barH ? ');
    expect(stories).toContain('closest("button, a, input, textarea, [data-story-interactive]")');
  });

  it("models fitness and fatigue honestly: performance comes up in the taper", () => {
    const { perf } = banister();
    expect(perf[perf.length - 1]).toBeGreaterThan(perf[29]);
  });

  it("asks an image model for a cover with no text, only when the coach taps (never on a schedule)", () => {
    expect(lessonArtPrompt({ title: "Heels up", lift: "squat", track: "fix" })).toContain("Absolutely no text, letters, numbers, logos or watermarks");
    const fn = read("src/lib/lesson-art.functions.ts");
    expect(fn).toContain("if (!key) return { ok: false as const");
    expect(fn).toContain('if (!(roles ?? []).some((r: any) => r.role === "admin" || r.role === "coach")) throw new Error("Not allowed");');
  });
});

describe("story stickers", () => {
  it("are checked the same way in the app and the database", () => {
    expect(cleanSticker({ type: "poll", q: "sumo or conv?", options: [{ label: "Sumo" }, { label: "sumo" }] })).toEqual({ ok: false, error: "Each answer needs to be different" });
    expect(cleanSticker({ type: "poll", q: "x", options: [{ label: "only one" }] })).toEqual({ ok: false, error: "A poll needs 2 to 4 answers" });
    expect(cleanSticker({ type: "slider", q: "how cooked?", emoji: "" })).toEqual({ ok: true, sticker: { type: "slider", q: "how cooked?", emoji: "🔥" } });
    expect(cleanSticker({ type: "question", q: " " }).ok).toBe(false);
    expect(sql).toContain("RAISE EXCEPTION 'Each answer needs to be different';");
  });

  it("show a poll's shares adding up to 100, and an answer at once", () => {
    expect(stickerPercents([1, 1, 1])).toEqual([34, 33, 33]);
    expect(stickerPercents([0, 0])).toEqual([0, 0]);
    let s: PostSticker = { type: "poll", q: "q", options: [{ label: "a", votes: 2 }, { label: "b", votes: 0 }], total: 2, is_mine: false, mine: null };
    s = answerSticker(s, { choice: 1 });
    expect([s.total, (s as any).options.map((o: any) => o.votes), s.mine]).toEqual([3, [2, 1], { choice: 1 }]);
    s = answerSticker(s, { choice: 0 });
    expect([s.total, (s as any).options.map((o: any) => o.votes)]).toEqual([3, [3, 0]]);
    s = answerSticker(s, { choice: null });
    expect([s.total, (s as any).options.map((o: any) => o.votes), s.mine]).toEqual([2, [2, 0], null]);
    let sl: PostSticker = { type: "slider", q: "q", emoji: "🔥", average: 50, total: 2, is_mine: false, mine: null };
    sl = answerSticker(sl, { value: 80 });
    expect([sl.total, (sl as any).average]).toEqual([3, 60]);
    expect([0, 1, 2].map((total) => stickerCountLabel({ type: "question", total }))).toEqual(["0 replies", "1 reply", "2 replies"]);
    expect(stickerCountLabel({ type: "poll", total: 1 })).toBe("1 vote");
  });

  it("sit a story sticker above the bottom bar, however tall the bar is", () => {
    const viewer = read("src/components/community/crew-stories.tsx");
    expect(viewer).toContain('stage.current?.querySelector<HTMLElement>("[data-story-bar], [data-story-mine-bar]")');
    expect(viewer).toContain("bottom: barH ? `${barH - 40 + 12}px`");
  });

  it("only the poster sees who answered, question answers are theirs alone, and nobody is pushed", () => {
    expect(sql).toContain("IF v_author = v_me THEN\n    v_out := v_out || jsonb_build_object('answers'");
    expect(sql).toContain("IF v_author = v_me THEN RAISE EXCEPTION 'That''s your own question'; END IF;");
    expect(sql).toContain("'sticker'', CASE WHEN n.sticker IS NOT NULL THEN public.community_sticker_json(n.id, _viewer) END,");
    expect(sql).not.toMatch(/community_notifications/);
  });

  it("anyone can put one on their own story (the story bar and the post's … menu)", () => {
    expect(read("src/components/community/crew-stories.tsx")).toContain("<PostStickerEditor post={post} open={sticker} onClose={() => setSticker(false)} />");
    expect(read("src/components/community/post-actions.tsx")).toContain('{post.sticker ? "Story sticker" : "Add a story sticker"}');
    expect(sql).toContain("IF NOT FOUND THEN RAISE EXCEPTION 'Only the person who posted can add a sticker' USING ERRCODE = '42501'; END IF;");
  });
});
