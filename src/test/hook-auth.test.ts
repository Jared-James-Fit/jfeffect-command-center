import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { authorizeHookRequest, timingSafeEqualStr } from "@/lib/hook-auth.server";

const req = (headers: Record<string, string>) => new Request("https://x.test/api/public/hooks/y", { method: "POST", headers });
const VAULT = "v".repeat(64);
const deps = (over: any = {}) => ({ workerSecret: "env-worker-secret", getVaultSecret: async () => VAULT, ...over });

describe("authorizeHookRequest", () => {
  it("accepts the worker secret (original scheme)", async () => {
    expect(await authorizeHookRequest(req({ "x-worker-secret": "env-worker-secret" }), deps())).toBe(true);
  });

  it("accepts the Vault-held cron secret (what pg_cron sends)", async () => {
    expect(await authorizeHookRequest(req({ "x-hook-secret": VAULT }), deps())).toBe(true);
  });

  it("works even when the env worker secret is not configured at all", async () => {
    expect(await authorizeHookRequest(req({ "x-hook-secret": VAULT }), deps({ workerSecret: "" }))).toBe(true);
  });

  it("rejects the public anon apikey, which is all the cron jobs used to send", async () => {
    const anon = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon-key-is-public";
    expect(await authorizeHookRequest(req({ apikey: anon }), deps())).toBe(false);
    expect(await authorizeHookRequest(req({ "x-hook-secret": anon }), deps())).toBe(false);
    expect(await authorizeHookRequest(req({ "x-worker-secret": anon }), deps())).toBe(false);
  });

  it("rejects wrong, empty and missing secrets", async () => {
    expect(await authorizeHookRequest(req({}), deps())).toBe(false);
    expect(await authorizeHookRequest(req({ "x-hook-secret": "" }), deps())).toBe(false);
    expect(await authorizeHookRequest(req({ "x-hook-secret": "w".repeat(64) }), deps())).toBe(false);
    // An empty env secret must never match an empty header.
    expect(await authorizeHookRequest(req({ "x-worker-secret": "" }), deps({ workerSecret: "" }))).toBe(false);
  });

  it("fails closed when the Vault secret is missing or the lookup throws", async () => {
    expect(await authorizeHookRequest(req({ "x-hook-secret": VAULT }), deps({ getVaultSecret: async () => null }))).toBe(false);
    expect(await authorizeHookRequest(req({ "x-hook-secret": VAULT }), deps({ getVaultSecret: async () => { throw new Error("db down"); } }))).toBe(false);
  });

  it("compares in constant time and rejects length mismatches", () => {
    expect(timingSafeEqualStr("abc", "abc")).toBe(true);
    expect(timingSafeEqualStr("abc", "abd")).toBe(false);
    expect(timingSafeEqualStr("abc", "abcd")).toBe(false);
  });
});

describe("every cron-scheduled hook uses the shared auth", () => {
  const dir = "src/routes/api/public/hooks";
  const scheduled = [
    "appointment-reminders", "birthday-notifications", "cleanup-pending-signups", "lift-archive-tick",
    "media-archive", "nutrition-tick", "sms-reminders", "action-centre-tick", "progress-archive-tick", "wearables-sync",
  ];

  it.each(scheduled)("%s delegates to authorizeHookRequest and no longer checks the env secret itself", (name) => {
    const src = readFileSync(`${dir}/${name}.ts`, "utf8");
    expect(src).toContain("authorizeHookRequest");
    expect(src).not.toContain("process.env.SCHEDULED_WORKER_SECRET");
  });

  it("the migration sends the Vault secret, never a literal, and drops the duplicate lift job", () => {
    const sql = readFileSync("supabase/migrations/20261007190000_cron_hook_auth.sql", "utf8");
    expect(sql).toContain("'x-hook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_hook_secret'");
    expect(sql).not.toMatch(/x-hook-secret['"]\s*,\s*'[0-9a-f]{20,}/i);
    expect(sql).not.toMatch(/apikey/i.source === "apikey" ? /'apikey'\s*,\s*'eyJ/ : /$^/);
    expect(sql).toContain("jobname = 'lift-archive-tick'");
    expect(sql).toContain("('sms-unread-reminders',             '*/10 * * * *', 'sms-reminders')");
    // Every hook file that exists is the target of exactly the jobs we re-point.
    const hooks = new Set(readdirSync(dir).map((f) => f.replace(/\.ts$/, "")));
    for (const m of sql.matchAll(/'([a-z-]+)'\)\s*(?:,|\n)/g)) if (hooks.has(m[1])) expect(hooks.has(m[1])).toBe(true);
  });
});
