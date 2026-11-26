import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("POV identity and passive Crew activity", () => {
  const impersonation = readFileSync("src/lib/client-impersonation.tsx", "utf8");
  const crew = readFileSync("src/components/community/community-screen.tsx", "utf8");
  it("does not treat a linked staff/athlete account as a normal visit while POV is active", () => {
    const guard = impersonation.split("export function useViewingAsClient")[1].split("export function usePortalUserId")[0];
    expect(guard).toContain("return !!client && !!user;");
    expect(guard).not.toContain("user.id !== client.user_id");
  });
  it("uses the selected account for the displayed weight unit, never the staff identity", () => {
    expect(crew).toContain("const portalUserId = usePortalUserId()");
    expect(crew).toContain('useViewerUnit(portalUserId)');
  });
  it("does not clear seen state or persist hints when previewing, even with editing enabled", () => {
    expect(crew).toContain("if (previewOnly || markedRef.current");
    expect(crew).toContain("if (!previewOnly) persistHint(key)");
    expect(crew).toContain("if (!previewOnly) attentionExit()");
  });
});
