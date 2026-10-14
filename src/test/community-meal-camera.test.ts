import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mealCameraCard, mealFuelMoment } from "@/lib/community";
import { TEMPLATE_LABEL } from "@/lib/workout-share-card";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("the camera opens in the iPhone app (or says exactly why not)", () => {
  const studio = read("src/components/community/share-studio.tsx");
  const platform = read("src/platform/index.ts");
  it("knows an app build from before the camera worked in it (#565 added the permission text from build 1842)", () => {
    expect(platform).toContain("export const IOS_CAMERA_MIN_BUILD = 1842;");
    expect(platform).toContain("const info = await (window as any).Capacitor?.Plugins?.App?.getInfo?.();");
    expect(platform).toContain("if (build != null) return build < IOS_CAMERA_MIN_BUILD;");
    // a build too old to say its number: no camera in its web view means no camera permission text
    expect(platform).toContain('return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia !== "function";');
  });
  it("an old build is sent to TestFlight and never into the phone's camera (that closes it)", () => {
    expect(studio).toContain("Update JF Effect to use the camera");
    expect(studio).toContain("onClick={openTestFlight}");
    expect(studio).toContain("if (status !== \"live\") return oldApp ? libRef.current?.click() : capRef.current?.click();");
    expect(platform).toContain('window.location.href = "itms-beta://";');
  });
  it("camera switched off: one tap to JF Effect's Settings; coming back retries it (iOS restarts the app, so it says to open Post again)", () => {
    expect(studio).toContain('setCamWhy(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "other");');
    expect(studio).toContain("Camera is off for JF Effect");
    expect(platform).toContain('window.location.href = "app-settings:";');
    // coming back to the app retries the live camera
    expect(studio).toContain('if (statusRef.current === "fallback") {');
    expect(studio).toContain("Turn on Camera, then open Post again.");
  });
});

describe("Meal on the camera", () => {
  it("five looks people share, then no filter; numbers-free (nothing private on a public card)", () => {
    const c = mealCameraCard({ athleteName: "Vicky Smith", now: new Date(2026, 9, 14, 12) });
    expect(c.looks).toEqual(["mealprep", "onplan", "fuel", "highday", "cheat", "plain"]);
    expect(c.looks.map((l) => TEMPLATE_LABEL[l])).toEqual(["Meal prep", "On plan", "Fuel", "High day", "Cheat meal", "No filter"]);
    expect(c.data.athleteName).toBe("Vicky");
    expect(c.data.stats).toEqual([]);
    expect(c.data.lift).toBeNull();
    expect(c.data.volume).toBeNull();
  });
  it("Fuel says post-workout for 3 hours after a session, pre-workout with one still to do today", () => {
    const now = Date.UTC(2026, 9, 14, 18);
    expect(mealFuelMoment({ lastFinishedAt: new Date(now - 3600e3).toISOString(), sessionToday: false, now })).toBe("post");
    expect(mealFuelMoment({ lastFinishedAt: new Date(now - 5 * 3600e3).toISOString(), sessionToday: true, now })).toBe("pre");
    expect(mealFuelMoment({ lastFinishedAt: null, sessionToday: false, now })).toBeNull();
    expect(mealCameraCard({ athleteName: null, fuel: "post" }).data.sessionLine).toBe("Post-workout");
  });
  it("it's a mode next to Post / Lock in / Workout; posts as a plain post (never League points), photo only", () => {
    const picker = read("src/components/community/share-workout-picker.tsx");
    expect(picker).toContain('{ key: "meal", label: "Meal" },');
    expect(picker).toContain("allowNoPhoto={activeMode !== \"meal\"}");
    expect(picker).toContain('accept={activeMode === "lockin" || activeMode === "meal" ? "image/*" : "image/*,video/*"}');
    const meal = picker.slice(picker.indexOf("const mealPost: StudioPost"), picker.indexOf("const modes = ["));
    expect(meal).toContain("createCommunityPost(qc,");
    expect(meal).not.toContain("shareToCommunity");
  });
  it("the cards: Nutrition Facts label, gold High day and red Cheat meal stickers", () => {
    const card = read("src/lib/workout-share-card.ts");
    expect(card).toContain('ctx.fillText("Locked In Facts", left, y);');
    expect(card).toContain('else if (d.template === "highday") drawMealSticker(ctx, d, logo, L, "high");');
    expect(card).toContain('const tag = kind === "high" ? "Planned. Not a cheat." : "Back on it tomorrow.";');
  });
});
