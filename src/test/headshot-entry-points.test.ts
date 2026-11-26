import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

/**
 * Nov 26 2026: the coach couldn't find where to request a headshot retake (the panel sat under
 * More → Client details, below five other cards). It's one tap from client management now.
 */
describe("account headshot request is reachable", () => {
  it("the Clients list row's ⋯ opens the headshot sheet, loaded only on first open", () => {
    const src = read("src/components/clients/quick-actions.tsx");
    expect(src).toContain("data-row-headshot");
    expect(src).toContain("Account headshot");
    expect(src).toMatch(/lazyWithRetry\(\(\) => import\("@\/components\/headshots\/headshot-admin"\)/);
    expect(src).toContain("{headshotMounted && (");
  });

  it("the client header's ⋯ opens the same sheet", () => {
    const src = read("src/route-pages/_authenticated/admin/clients.$id.tsx");
    expect(src).toContain("data-header-headshot");
    expect(src).toContain("<HeadshotSheet open={headshotOpen}");
  });

  it("Client details leads with the headshot panel", () => {
    const src = read("src/route-pages/_authenticated/admin/clients.$id.tsx");
    const info = src.indexOf('<TabsContent value="info"');
    const panel = src.indexOf("<AccountHeadshotPanel", info);
    const personal = src.indexOf("Personal Information", info);
    expect(info).toBeGreaterThan(-1);
    expect(panel).toBeGreaterThan(info);
    expect(panel).toBeLessThan(personal);
  });

  it("the sheet shows the panel bare (no card inside a sheet)", () => {
    const src = read("src/components/headshots/headshot-admin.tsx");
    expect(src).toMatch(/export function HeadshotSheet/);
    expect(src).toContain("<AccountHeadshotPanel clientId={clientId} clientName={clientName} bare />");
  });
});
