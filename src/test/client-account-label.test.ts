import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { accountKind, clientAccountLabel, statusChoicesFor } from "@/lib/client-account-label";

const read = (f: string) => readFileSync(f, "utf8");

describe("the account label reads the record, not a hand-set status", () => {
  it("a lead who has signed in is a client (Devin)", () => {
    expect(clientAccountLabel({ status: "Lead", service_tier: "coaching", last_signed_in_at: "2026-11-06T19:56:08Z" }).label).toBe("Client");
    expect(clientAccountLabel({ status: "Lead", service_tier: "coaching" }).label).toBe("Lead");
  });

  it("old hand-set statuses read as Client", () => {
    for (const status of ["New Client", "Active", "Needs Attention", "Payment Overdue", "High Priority", "", null]) {
      expect(accountKind({ status, service_tier: "coaching", last_signed_in_at: "2026-10-01T00:00:00Z" })).toBe("client");
    }
  });

  it("free accounts, pauses and endings", () => {
    expect(clientAccountLabel({ status: "Member", service_tier: "self_serve" }).label).toBe("Member");
    expect(clientAccountLabel({ status: "Lead", service_tier: "self_serve" }).label).toBe("Member");
    expect(clientAccountLabel({ status: "Paused", service_tier: "coaching" })).toMatchObject({ label: "Paused", tone: "warn" });
    expect(clientAccountLabel({ status: "Cancelling", service_tier: "coaching" })).toMatchObject({ label: "Cancelling", tone: "warn" });
    expect(clientAccountLabel({ status: "Deactivated", service_tier: "coaching" }).label).toBe("Deactivated");
    expect(clientAccountLabel({ status: "Active", archived: true }).label).toBe("Archived");
    expect(clientAccountLabel({ status: "Archived" }).label).toBe("Archived");
  });

  it("the status picker offers what the data can't tell, and never shows blank", () => {
    expect(statusChoicesFor("Active").map((c) => c.label)).toEqual(["Lead", "Client", "Paused", "Cancelling"]);
    expect(statusChoicesFor("Lead").some((c) => c.value === "Lead")).toBe(true);
    expect(statusChoicesFor("New Client").at(-1)).toEqual({ value: "New Client", label: 'Client (was "New Client")' });
    expect(statusChoicesFor("Deactivated").at(-1)).toEqual({ value: "Deactivated", label: "Deactivated" });
  });

  it("both client headers use it", () => {
    const page = read("src/route-pages/_authenticated/admin/clients.$id.tsx");
    expect(page).toMatch(/subtitle=\{accountSubtitle\(form\)\}/);
    expect(page).toMatch(/const account = clientAccountLabel\(form\);/);
    expect(page).not.toMatch(/badges: form\.status \?/);
  });
});

describe("a lead becomes a client on their first sign-in", () => {
  const sql = read("supabase/migrations/20270223090000_lead_becomes_client_on_sign_in.sql");

  it("promotes a coaching Lead, closes its application, and backfills", () => {
    expect(sql).toMatch(/c\.service_tier = 'coaching' AND c\.status = 'Lead'/);
    expect(sql).toMatch(/status = CASE WHEN v_was_lead THEN 'Active'/);
    expect(sql).toMatch(/lifecycle_stage = CASE WHEN v_was_lead THEN 'active_client'/);
    expect(sql).toMatch(/UPDATE public\.coaching_applications\s+SET status = 'Approved'/);
    expect(sql).toMatch(/WITH promoted AS \(/);
  });

  it("writes as the server, so the self-update guards can't drop the sign-in, then puts the claims back", () => {
    const clear = sql.indexOf("PERFORM set_config('request.jwt.claims', '', true);");
    const update = sql.indexOf("UPDATE public.clients\n     SET last_signed_in_at");
    const restore = sql.indexOf("PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);");
    expect(clear).toBeGreaterThan(0);
    expect(update).toBeGreaterThan(clear);
    expect(restore).toBeGreaterThan(update);
    // The person is read before the claims are cleared.
    expect(sql.indexOf("v_uid uuid := auth.uid();")).toBeLessThan(clear);
  });
});
