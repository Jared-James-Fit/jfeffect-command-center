import { describe, expect, it } from "vitest";
import fs from "node:fs";

const read = (p: string) => fs.readFileSync(p, "utf8");

describe("Client POV safety", () => {
  it("draws a red frame around the portal while viewing as a client", () => {
    const banner = read("src/components/client-pov-banner.tsx");
    expect(banner).toContain("export function PovFrame");
    expect(banner).toContain("pointer-events-none");
    expect(banner).toContain("var(--destructive)");
    expect(read("src/routes/_authenticated/portal/route.tsx")).toContain("<PovFrame />");
  });

  it("asks before anything is sent under the client's name, and only inside the portal", () => {
    const guard = read("src/components/pov/pov-send-guard.tsx");
    expect(guard).toContain('startsWith("/portal")');
    expect(guard).toContain("Send as");
    expect(guard).toContain("Yes, send as");

    const dm = read("src/components/message-thread.tsx");
    const group = read("src/components/group-message-thread.tsx");
    for (const src of [dm, group]) {
      expect(src).toContain("usePovSendGuard()");
      expect(src).toContain("{povGuard.dialog}");
      expect(src.match(/povGuard\.confirm\(/g)?.length).toBeGreaterThanOrEqual(4); // text/media, voice, GIF, sound
    }
    // Voice goes through doSend after its own prompt, so it must not ask twice.
    expect(dm).toContain("povConfirmed: true");
  });
});
