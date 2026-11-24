/**
 * Nov 24 2026: eight cron jobs called their hook with pg_net's default 5 s timeout. The lift-archive
 * run often takes longer, and when one of those calls timed out pg_net dropped the other calls sent
 * in the same moment ("Client cancelled"), which is how the training roadmap job wrote nothing at :28
 * and :58. 20270522091000_cron_hook_timeouts.sql gave them all a real timeout; every hook call a
 * migration schedules from then on has to say how long it waits.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = "supabase/migrations";
const FROM = "20270522091000";

/** Each `net.http_post( … )` call in a SQL file, with its arguments. */
function postCalls(sql: string): string[] {
  const out: string[] = [];
  const re = /net\.http_post\s*\(/gi;
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < sql.length && depth > 0; i++) {
      if (sql[i] === "(") depth++;
      else if (sql[i] === ")") depth--;
    }
    out.push(sql.slice(m.index, i));
  }
  return out;
}

describe("a scheduled hook call always says how long it waits", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql") && f >= FROM).sort();
  it("the fix is there", () => {
    const fix = readFileSync(`${DIR}/${FROM}_cron_hook_timeouts.sql`, "utf8");
    expect(fix).toContain("cron.alter_job");
    expect(fix).toContain("timeout_milliseconds := ' || wait_ms");
  });
  it("every net.http_post in a migration from then on has timeout_milliseconds", () => {
    const missing = files.flatMap((f) =>
      postCalls(readFileSync(`${DIR}/${f}`, "utf8"))
        .filter((call) => !/timeout_milliseconds/i.test(call))
        .map((call) => `${f}: ${call.replace(/\s+/g, " ").slice(0, 80)}`),
    );
    expect(missing).toEqual([]);
  });
  it("finds a call with no timeout", () => {
    expect(postCalls("select net.http_post(url := 'x', body := '{}'::jsonb) as id;")).toHaveLength(1);
    expect(postCalls("select net.http_post(url := 'x', body := jsonb_build_object('a', 1), timeout_milliseconds := 1000);")[0]).toMatch(/timeout_milliseconds/);
  });
});
