import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("scheduled jobs health check", () => {
  const sql = read("supabase/migrations/20261008190000_scheduled_jobs_health_ignore_deploy_blips.sql");

  it("separates the app's HTML 404 page (deploy rollout) from hard failures", () => {
    expect(sql).toContain("r.status_code = 404 and coalesce(r.content, '') ilike '<!doctype html%'");
    expect(sql).toContain("and not coalesce(html404, false)");
  });

  it("only alerts on HTML 404s that persist (a genuinely missing route)", () => {
    expect(sql).toContain("v_html404 >= 3");
    expect(sql).toContain("v_html404_last > now() - interval '15 minutes'");
    expect(sql).toContain("v_html404_last - v_html404_first >= interval '20 minutes'");
    expect(sql).toContain("v_unhealthy := v_hard_failed >= 3 or v_html404_persistent or v_cron_failed >= 2;");
  });
});

describe("support alerts page", () => {
  const page = read("src/route-pages/_authenticated/admin/support-alerts.tsx");

  it("shows bulk selection only on request, not as an always-on toolbar", () => {
    expect(page).toContain("alerts.length > 1 &&");
    expect(page).toContain("{selecting && (");
  });

  it("saves notes explicitly instead of on blur", () => {
    expect(page).not.toContain("onBlur");
    expect(page).toContain("saveNote");
  });

  it("gives system alerts their own icon instead of a fake avatar and coach line", () => {
    expect(page).toContain("<ServerCog");
    expect(page).toContain("{!isSystem && <>");
  });
});
