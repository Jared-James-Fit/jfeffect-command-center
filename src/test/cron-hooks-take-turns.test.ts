/**
 * Nov 26 2026: four scheduled hook calls started in the same second at every minute ending in 0
 * (ai-health-tick, appointment-reminders-tick, sms-unread-reminders, lift-archive-tick-2m), and 1 in
 * 9 of those minutes lost a call to Cloudflare 1102 (the shared worker out of memory), against about
 * 1 in 160 of the rest. 20270531090000_cron_hooks_spread_out.sql gave three of them minutes of their
 * own and made two ask the database before calling. From then on a migration that schedules a hook
 * call either asks first (`where exists`) or keeps off the minutes the every-5 / 10 / 15 jobs share.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = "supabase/migrations";
const FROM = "20270531090000";

/** The minutes of the hour a cron minute field fires on ("*", "*\/5", "2-59/5", "7,37", "0"). */
function minutesOf(field: string): number[] {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const [range, stepText] = part.split("/");
    const step = stepText ? Number(stepText) : 1;
    let lo = 0;
    let hi = 59;
    if (range !== "*") {
      const [a, b] = range.split("-").map(Number);
      lo = a;
      hi = b ?? (stepText ? 59 : a);
    }
    for (let m = lo; m <= hi; m += step) out.add(m);
  }
  return [...out].sort((a, b) => a - b);
}

/** Each `cron.schedule('name', 'schedule', …)` in a SQL file, with the text up to the next one. */
function schedules(sql: string): Array<{ name: string; schedule: string; body: string }> {
  const re = /cron\.schedule\s*\(\s*'([^']+)'\s*,\s*'([^']+)'/gi;
  const hits = [...sql.matchAll(re)];
  return hits.map((m, i) => ({
    name: m[1],
    schedule: m[2],
    body: sql.slice(m.index!, hits[i + 1]?.index ?? sql.length),
  }));
}

describe("scheduled hook calls take turns", () => {
  it("reads cron minute fields", () => {
    expect(minutesOf("*/5")).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
    expect(minutesOf("2-59/5")).toEqual([2, 7, 12, 17, 22, 27, 32, 37, 42, 47, 52, 57]);
    expect(minutesOf("8-59/10")).toEqual([8, 18, 28, 38, 48, 58]);
    expect(minutesOf("7,37")).toEqual([7, 37]);
    expect(minutesOf("0")).toEqual([0]);
    expect(minutesOf("*")).toHaveLength(60);
  });

  it("the fix moves the three always-on jobs off the shared minutes and guards the two idle ones", () => {
    const fix = readFileSync(`${DIR}/${FROM}_cron_hooks_spread_out.sql`, "utf8");
    for (const [job, from, to] of [
      ["ai-health-tick", "*/5 * * * *", "2-59/5 * * * *"],
      ["appointment-reminders-tick", "*/5 * * * *", "4-59/5 * * * *"],
      ["sms-unread-reminders", "*/10 * * * *", "8-59/10 * * * *"],
    ]) {
      expect(fix, job).toContain(`('${job}', '${from}')`);
      expect(fix, job).toContain(`then '${to}'`);
    }
    // ai-health-tick's hourly and 9am parts read "the first 5 minutes of the hour": :02 is still in it, once
    expect(minutesOf("2-59/5").filter((m) => m < 5)).toEqual([2]);
    const monitor = readFileSync("src/lib/ai/ai-monitor.server.ts", "utf8");
    expect(monitor).toContain("getUTCMinutes() < 5");
    // the two guards ask exactly what their hooks pick up
    expect(fix).toContain("from public.lift_videos");
    expect(fix).toContain("archive_attempts < 5");
    expect(readFileSync("src/lib/lift-archive.server.ts", "utf8")).toMatch(/const MAX_ATTEMPTS = 5;/);
    expect(fix).toContain("from public.pl_roadmap_queue");
    expect(fix).toContain("queued_at <= now() - interval ''2 minutes''");
    expect(readFileSync("src/lib/training-roadmap.server.ts", "utf8")).toMatch(/const SETTLE_MS = 2 \* 60_000;/);
    // only a job still as it was is changed
    expect(fix).toContain("command !~* 'where\\s+exists'");
  });

  it("no always-on hook call scheduled from then on lands on a minute the every-5 jobs share", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".sql") && f > `${FROM}_`).sort();
    const crowded = files.flatMap((f) =>
      schedules(readFileSync(`${DIR}/${f}`, "utf8"))
        .filter((s) => /net\.http_post/i.test(s.body) && !/where\s+exists/i.test(s.body))
        .filter((s) => minutesOf(s.schedule.trim().split(/\s+/)[0]).some((m) => m % 5 === 0))
        .map((s) => `${f}: ${s.name} '${s.schedule}'`),
    );
    expect(crowded).toEqual([]);
  });
});
