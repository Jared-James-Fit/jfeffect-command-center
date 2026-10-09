import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  SERIES_LABEL,
  TIP_KIND_LABEL,
  compareBars,
  extraFeature,
  extraObservation,
  extraScene,
  extraTipKind,
  isRecapStats,
  isWinsStats,
  recapSummary,
  type RecapStats,
} from "@/lib/community";
import { SPIRIT_SCENE_KEYS } from "@/components/community/spirit-scenes";

const read = (f: string) => readFileSync(f, "utf8");
const sql = read("supabase/migrations/20261017090000_community_week_series.sql");
const fn = (name: string) => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = sql.indexOf("$$;", start);
  return sql.slice(start, end);
};
/** The words that go out, from the seeded libraries. */
const libraryBodies = (series: string) => {
  const block = sql.slice(sql.indexOf(`SELECT '${series}'`), sql.indexOf(`WHERE NOT EXISTS (SELECT 1 FROM public.community_series_items i WHERE i.series = '${series}')`));
  return [...block.matchAll(/\(\d+, '([a-z_]+)', '((?:[^']|'')*)'/g)].map((m) => ({ key: m[1], body: m[2].replace(/''/g, "'") }));
};

describe("a post for every day of the week", () => {
  it("one job every 15 minutes; each day knows its own window (Winnipeg time)", () => {
    expect(sql).toContain("PERFORM cron.unschedule('community-weekly-coach-posts');");
    expect(sql).toContain("PERFORM cron.unschedule('community-wednesday-wins');");
    expect(sql).toContain("PERFORM cron.schedule('community-daily-series', '*/15 * * * *', 'select public.community_publish_series();');");
    const pub = fn("community_publish_series");
    expect(pub).toContain("WHEN 'saturday_spirit' THEN time '09:00' WHEN 'sunday_recap' THEN time '19:00'");
    expect(pub).toContain("v_end := CASE WHEN v_start >= time '19:00' THEN time '23:59:59' ELSE v_start + interval '5 hours' END;");
    expect(pub).toContain("v_dow <> array_position(c_days, v_series)");
  });
  it("still once per day-theme per week, paused by the same switch, coaches only", () => {
    const pub = fn("community_publish_series");
    expect(pub).toContain("v_key := v_series || ':' || to_char(v_local, 'IYYY-\"W\"IW');");
    expect(pub).toContain("IF EXISTS (SELECT 1 FROM public.community_series_runs r WHERE r.series_key = v_key) THEN");
    expect(pub).toContain("IF coalesce(v_settings.paused, false) THEN RETURN jsonb_build_object('status', 'paused'); END IF;");
    expect(pub).toContain("IF auth.uid() IS NOT NULL AND NOT public.is_community_staff() THEN");
  });
  it("labels every day, Monday first", () => {
    expect(Object.keys(SERIES_LABEL)).toEqual([
      "monday_motivation", "tuesday_tips", "wednesday_wins", "try_it_thursday", "finish_strong_friday", "saturday_spirit", "sunday_recap",
    ]);
    expect(SERIES_LABEL.tuesday_tips.name).toBe("Tuesday Tips & Tricks");
    expect(SERIES_LABEL.try_it_thursday.name).toBe("Try it Thursday");
    expect(SERIES_LABEL.sunday_recap.short).toBe("Sun");
  });
  it("an app that hasn't updated never tries to draw a new post as a Wins card", () => {
    const json = fn("community_post_json");
    expect(json).toContain("'series_data', CASE WHEN n.series IS NULL OR n.series IN ('wednesday_wins', 'sunday_recap') THEN n.series_data END,");
    expect(json).toContain("'series_extra', CASE WHEN n.series IN ('tuesday_tips', 'try_it_thursday', 'saturday_spirit') THEN n.series_data END,");
  });
});

describe("only real numbers, and only when they say something", () => {
  it("both sides need 3+ people and a 25%+ gap, or nothing is said", () => {
    const cmp = fn("community_crew_compare");
    expect(cmp).toContain("IF v_a < 3 OR v_b < 3 OR v_x IS NULL OR v_y IS NULL THEN RETURN NULL; END IF;");
    expect(cmp).toContain("IF v_x < v_y * 1.25 OR v_x - v_y < (CASE _outcome WHEN 'prs' THEN 2 ELSE 0.5 END) THEN RETURN NULL; END IF;");
  });
  it("8 full weeks, and people who started inside them aren't counted (everything's a PR at first)", () => {
    const out = fn("community_crew_outcomes");
    expect(out).toContain("date_trunc('week', now() AT TIME ZONE 'America/Winnipeg') - interval '56 days'");
    expect(out).toContain("AND EXISTS (SELECT 1 FROM public.pl_day_completions pc WHERE pc.client_id = cl.id AND pc.completed_at < w.f)");
    expect(out).toContain("AND cl.user_id IS DISTINCT FROM _exclude_user");
  });
  it("Tuesday: never two data posts in a row, each kind once per 8 weeks, says 'probably'", () => {
    const obs = fn("community_compose_observation");
    expect(obs).toContain("WHERE p.series = 'tuesday_tips' ORDER BY p.created_at DESC LIMIT 1), false) THEN\n    RETURN NULL;");
    expect(obs).toContain("p.created_at > now() - interval '56 days'");
    expect(obs).toContain("probably not magic, its practice");
    expect(obs).toContain("IF v_lo.n_lo >= 10 AND v_lo.p_lo >= 3 AND v_lo.n_hi >= 30 AND v_lo.r_hi - v_lo.r_lo >= 0.3 THEN");
  });
  it("Thursday: the stat says what it is (people who use it), not that the feature caused it", () => {
    expect(fn("community_feature_stat")).toContain("not saying the feature does it for you, the people who use it are just more locked in");
    // logging features are judged on how often people train, never on PRs (PRs come from logging)
    expect(sql).not.toMatch(/"habit":"(fully_logged|reviews)"[^']*"outcome":"prs"/);
  });
  it("aggregates only on Tuesday/Thursday: no names, no client ids in what goes out", () => {
    expect(fn("community_compose_observation")).not.toContain("'name'");
    expect(fn("community_feature_stat")).not.toContain("'name'");
  });
});

describe("Sunday Recap: the week's report card", () => {
  const recap = fn("community_compose_recap");
  it("the plan is what each person committed to, and extra sessions don't cover someone else's", () => {
    expect(recap).toContain("coalesce(nullif(cl.committed_training_frequency, 0), array_length(cl.committed_training_days, 1)) AS goal");
    expect(recap).toContain("sum(least(t.done, t.goal))");
    expect(recap).toContain("pc.completed_at >= v_to - interval '35 days'");
  });
  it("one thing to work on, the first that applies: plan, logging, check-ins, quietest day", () => {
    expect(recap).toContain("WHEN v_planned >= 6 AND v_pct < 80 THEN jsonb_build_object('kind', 'plan'");
    expect(recap).toContain("WHEN v_completed >= 6 AND v_logged * 10 < v_completed * 7 THEN jsonb_build_object('kind', 'logging'");
    expect(recap).toContain("ELSE jsonb_build_object('kind', 'day'");
  });
  it("its top 3 are the week's biggest moments, and count toward Wednesday's rotation", () => {
    expect(recap).toContain("WHERE w->>'type' <> 'sessions') z\n   WHERE z.rn <= 3;");
    expect(fn("community_publish_series")).toContain("SELECT v_key, (f->>'client_id')::uuid, f->>'type', coalesce(_at, now()) FROM jsonb_array_elements(coalesce(v_comp->'featured', '[]'::jsonb)) f");
  });
  it("Wednesday drops its numbers card once Sunday has shown that week", () => {
    expect(fn("community_publish_series")).toContain("WHERE r.series_key = 'sunday_recap:' || to_char(date_trunc('week', v_local)::date - 1, 'IYYY-\"W\"IW'))\n                     THEN NULL ELSE v_comp->'stats' END;");
  });

  const s: RecapStats = {
    kind: "recap", week_of: "2026-09-28", roster: 15, opened: 15, trained: 12, sessions: 36, sessions_prev: 32, prs: 41, pr_people: 9,
    volume_kg: 204215, reps: 6015, streaks: 10, bodyweight: 9, checkins: 4, busiest_day: "Friday",
    planned: 43, planned_done: 35, hit: 7, active: 12, days: [8, 3, 5, 4, 9, 3, 4], completed: 36, fully_logged: 25,
    top: [{ name: "Reecey", type: "atpr", text: "Reecey just hit 265lbs x 8 on hack squat. all time PR" }],
    improve: { kind: "logging", text: "69% of workouts had every set logged." },
  };
  it("reads at a glance: % of the plan, logging %, the busiest day, vs last week", () => {
    const r = recapSummary(s);
    expect(r.planPct).toBe(81);
    expect(r.logPct).toBe(69);
    expect(r.days.map((d) => d.letter).join("")).toBe("MTWTFSS");
    expect(r.days.find((d) => d.best)?.n).toBe(9);
    expect(r.vsLast).toBe("4 more than last week");
    expect(recapSummary({ ...s, planned: 0, completed: 0 }).planPct).toBeNull();
  });
  it("the app tells a recap from a Wins card from anything else", () => {
    expect(isRecapStats(s)).toBe(true);
    expect(isWinsStats(s)).toBe(true);
    expect(isRecapStats({ scene: "keep_digging" })).toBe(false);
    expect(isWinsStats({ feature: "bodyweight" })).toBe(false);
    const card = read("src/components/community/post-card.tsx");
    expect(card).toContain('if (post.series === "sunday_recap" && isRecapStats(post.series_data)) return <SundayRecapCard');
    expect(card).toContain("if (isWinsStats(post.series_data)) return <WinsStatsCard");
  });
});

describe("Tuesday, Thursday, Saturday on the post", () => {
  it("Saturday: the picture first, a line under it; every scene in the library is drawn", () => {
    const scenes = libraryBodies("saturday_spirit");
    expect(scenes.map((x) => x.key).sort()).toEqual([...SPIRIT_SCENE_KEYS].sort());
    expect(extraScene({ scene: "year_dots" })).toBe("year_dots");
    expect(read("src/components/community/post-card.tsx")).toContain('{scene && isSpiritScene(scene) && <SpiritScene scene={scene} className="mb-3 rounded-2xl" />}');
    for (const { body } of scenes) expect(body.split(/\s+/).length).toBeLessThanOrEqual(14);
  });
  it("Tuesday: library tips say what kind they are; data posts get two bars", () => {
    expect(extraTipKind({ kind: "cue" })).toBe("Cue to test");
    const obs = extraObservation({ observation: "frequency", habit: "sessions", outcome: "prs", a: 4, b: 7, x: 21, y: 10 });
    expect(obs).not.toBeNull();
    const bars = compareBars(obs!);
    expect(bars.map((r) => [r.label, r.count, r.value])).toEqual([["3+ sessions a week", "4 people", "21 PRs"], ["Fewer", "7 people", "10 PRs"]]);
    const sleep = compareBars({ habit: "sleep", outcome: "rating", a: 15, b: 400, x: 4.1, y: 4.5 });
    expect(sleep[0].count).toBe("15 sessions");
    expect(sleep[0].value).toBe("4.1 / 5");
    expect(sleep[0].share).toBeCloseTo(4.1 / 5);
    expect(compareBars({ habit: "bodyweight", outcome: "spw", a: 4, b: 7, x: 4, y: 2.3 }).map((r) => r.value)).toEqual(["4.0x a week", "2.3x a week"]);
  });
  it("Thursday: where to find it, and the stat only when the post carries one", () => {
    const f = extraFeature({ feature: "bodyweight", title: "Log your bodyweight", where: ["Home", "Bodyweight card", "Log Weight"], stat: null });
    expect(f?.where).toEqual(["Home", "Bodyweight card", "Log Weight"]);
    expect(extraFeature({ scene: "iceberg" })).toBeNull();
    // the paths named in the posts are the app's real labels
    expect(read("src/components/portal/bodyweight-summary-card.tsx")).toContain("Log Weight");
    expect(read("src/components/home/home-water-card.tsx")).toContain("Water Today");
    expect(read("src/components/nutrition/CookbookSheet.tsx")).toContain("Open Cookbook");
    expect(read("src/components/workout/shared/workout-review-editor.tsx")).toContain("How'd it go?");
  });
});

describe("the words sound like the coach and stay inside the lines", () => {
  const banned = ["navigating", "it's clear that", "solid win", "momentum", "journey", "dial in", "keep it up", "significantly", "ensure", "crucial", "optimal", "prioritize", "—"];
  it("Tuesday & Thursday: 40-90 words, none of the banned phrases", () => {
    const bodies = [...libraryBodies("tuesday_tips"), ...libraryBodies("try_it_thursday")].map((x) => x.body);
    expect(libraryBodies("tuesday_tips").every((x) => TIP_KIND_LABEL[x.key])).toBe(true);
    expect(bodies.length).toBe(37);
    for (const b of bodies) {
      const words = b.split(/\s+/).length;
      expect(words, b).toBeGreaterThanOrEqual(40);
      expect(words, b).toBeLessThanOrEqual(90);
      for (const w of banned) expect(b.toLowerCase(), b).not.toContain(w);
    }
  });
  it("the coach screen shows all seven days and what the data days would say right now", () => {
    const coach = read("src/components/community/coach-weekly-posts.tsx");
    for (const k of Object.keys(SERIES_LABEL)) expect(coach).toContain(`"${k}"`);
    expect(coach).toContain('useSeriesPreview("sunday_recap", isOpen("sunday_recap"))');
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.community_series_preview(_series text)");
  });
});
