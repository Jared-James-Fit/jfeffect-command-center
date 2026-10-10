import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const fallback = read("src/components/router-error-fallback.tsx");
const sql = read("supabase/migrations/20261104090000_report_page_error.sql");

describe("a page that fails tells us what broke", () => {
  it("records the failure once the retries are spent, before any early return (hook order)", () => {
    const hook = fallback.indexOf('rpc("report_page_error"');
    expect(hook).toBeGreaterThan(0);
    expect(fallback).toContain("const showing = !chunkError && retryCount >= MAX_AUTO_RETRIES;");
    expect(hook).toBeLessThan(fallback.indexOf("if (chunkError) {\n    return ("));
    expect(hook).toBeLessThan(fallback.indexOf("if (retryCount < MAX_AUTO_RETRIES) {"));
  });

  it("shows the error details already open", () => {
    expect(fallback).toContain("<details open ");
  });

  it("the database dedupes per user, route and message for an hour and notifies nobody", () => {
    expect(sql).toContain("error_type = 'page_error' AND page_route = v_route AND error_message = v_msg");
    expect(sql).toContain("created_at > now() - interval '1 hour'");
    expect(sql).toContain("IF v_uid IS NULL THEN RETURN; END IF;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.report_page_error(text, text, text, jsonb) TO authenticated;");
    expect(read("src/lib/support-alert-text.ts")).toContain('page_error: "A page failed to load"');
  });
});

describe("a page that keeps failing heals itself once", () => {
  it("clears the device's saved data and reloads, once per session, before the error screen", () => {
    expect(fallback).toContain('const CACHE_RESET_KEY = "jf:route-error-cache-reset";');
    expect(fallback).toContain("clearPersistedQueryCache();");
    expect(fallback).toContain('try { done = window.sessionStorage.getItem(CACHE_RESET_KEY) === "1"; } catch { done = true; }');
    expect(fallback).toContain('try { window.sessionStorage.setItem(CACHE_RESET_KEY, "1"); } catch { return; }');
    expect(fallback.indexOf("clearPersistedQueryCache();")).toBeLessThan(fallback.indexOf("if (chunkError) {\n    return ("));
  });

  it("every device starts from a fresh saved cache after this publish", () => {
    expect(read("src/lib/query-persister.ts")).toContain('export const QUERY_PERSIST_BUSTER = "v7";');
  });
});
