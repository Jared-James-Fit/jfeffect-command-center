import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const cam = read("src/components/community/share-studio.tsx");

describe("the live camera starts in the iPhone app too", () => {
  it("goes live when frames arrive, never waiting on play() (which can stay pending in an app's web view)", () => {
    expect(cam).toContain('video.addEventListener("loadeddata", live, { once: true });');
    expect(cam).toContain('video.addEventListener("playing", live, { once: true });');
    expect(cam).toContain("void video.play().then(live,");
    expect(cam).not.toContain("await video.play();");
    // iOS plays a camera inline only with these as attributes
    expect(cam).toContain('video.setAttribute("playsinline", "");');
    expect(cam).toContain('video.setAttribute("muted", "");');
  });

  it("asks again with simpler settings when a camera can't do the first; a refusal is final", () => {
    expect(cam).toContain("{ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false },");
    expect(cam).toContain("{ video: { facingMode: facing }, audio: false },");
    expect(cam).toContain("{ video: true, audio: false },");
    expect(cam).toContain('if (name === "NotAllowedError" || name === "SecurityError") break;');
  });

  it("says why it didn't start: a support alert from the phone app with the exact reason", () => {
    expect(cam).toContain('report("no camera API in this web view");');
    expect(cam).toContain("report(`timed out (${step})`);");
    expect(cam).toContain('if (name !== "NotAllowedError") report(`${name ?? "error"}: ${err?.message ?? String(e)}`);');
    const rep = read("src/lib/camera-report.ts");
    expect(rep).toContain('if (typeof window === "undefined" || !isNative()) return;');
    expect(rep).toContain('rpc("report_page_error", {');
    expect(rep).toContain("_message: `Live camera didn't start: ${reason}`");
  });
});
