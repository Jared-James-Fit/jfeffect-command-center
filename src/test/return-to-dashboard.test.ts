import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { landingPath, withinReturnScope } from "@/components/return-to-dashboard";

describe("‹ Today pill", () => {
  it("knows where a dashboard link lands (incl. redirects)", () => {
    expect(landingPath("/admin/clients?flags=no_payment")).toBe("/admin/clients");
    expect(landingPath("/admin/messages?client=abc")).toBe("/admin/communication");
    expect(landingPath("/admin/transactions/")).toBe("/admin/transactions");
  });

  it("stays while you look around that section, goes when you leave it", () => {
    expect(withinReturnScope("/admin/clients", "/admin/clients")).toBe(true);
    expect(withinReturnScope("/admin/clients/123", "/admin/clients")).toBe(true);
    expect(withinReturnScope("/admin/clients-archive", "/admin/clients")).toBe(false);
    expect(withinReturnScope("/admin/programming", "/admin/clients")).toBe(false);
  });

  it("dashboard quick looks arm it; there's no quick-action grid or More sheet (each action lives on its own page)", () => {
    const src = readFileSync("src/routes/_authenticated/admin/index.tsx", "utf8");
    expect(src).toMatch(/onClickCapture=\{onDashboardClickCapture\}/);
    expect(src).not.toContain("ActionsSheet");
    expect(src).not.toContain("primaryActions");
    // Add client stays one tap away in the Clients page header.
    expect(readFileSync("src/routes/_authenticated/admin/clients.index.tsx", "utf8")).toContain("<AddClientDialog");
    expect(readFileSync("src/routes/_authenticated/admin/route.tsx", "utf8")).toMatch(/<ReturnToDashboardPill \/>/);
  });
});
