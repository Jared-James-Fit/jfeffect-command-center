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

  it("dashboard quick looks arm it; quick actions and the More sheet don't", () => {
    const src = readFileSync("src/routes/_authenticated/admin/index.tsx", "utf8");
    expect(src).toMatch(/onClickCapture=\{onDashboardClickCapture\}/);
    expect(src).toMatch(/className="grid grid-cols-5 gap-2" data-no-return/);
    expect(src).toMatch(/<SheetContent side="bottom" className="rounded-t-2xl" data-no-return>/);
    expect(readFileSync("src/routes/_authenticated/admin/route.tsx", "utf8")).toMatch(/<ReturnToDashboardPill \/>/);
  });
});
