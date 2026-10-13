import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
/** One workflow step's text, from its "- name:" to the next step. */
const step = (wf: string, name: string) => {
  const start = wf.indexOf(`- name: ${name}\n`);
  expect(start, name).toBeGreaterThan(-1);
  const end = wf.indexOf("\n      - name:", start + 1);
  return { at: start, text: wf.slice(start, end === -1 ? undefined : end) };
};

describe("the phone apps ask for the camera instead of crashing", () => {
  it("iOS: camera, microphone and photo purpose strings are set on every build, before pods and the archive", () => {
    const wf = read(".github/workflows/ios-build.yml");
    const s = step(wf, "Set camera, microphone and photo purpose strings");
    expect(s.at).toBeGreaterThan(wf.indexOf("- name: Setup iOS platform"));
    expect(s.at).toBeLessThan(wf.indexOf("- name: Run pod install"));
    // never behind a switch: it used to live in the optional HealthKit step, so builds shipped without it
    expect(s.text).not.toMatch(/\n\s+if:/);
    for (const key of ["NSCameraUsageDescription", "NSMicrophoneUsageDescription", "NSPhotoLibraryUsageDescription", "NSPhotoLibraryAddUsageDescription"]) {
      expect(s.text).toContain(`"${key}"`);
    }
  });

  it("Android: camera and microphone are declared so the page's request becomes Android's own popup", () => {
    const wf = read(".github/workflows/android-build.yml");
    const s = step(wf, "Declare camera and microphone permissions");
    expect(s.at).toBeGreaterThan(wf.indexOf("- name: Add Android platform"));
    expect(s.at).toBeLessThan(wf.indexOf("- name: Run cap sync"));
    expect(s.text).not.toMatch(/\n\s+if:/);
    expect(s.text).toContain("android.permission.CAMERA");
    expect(s.text).toContain("android.permission.RECORD_AUDIO");
    expect(s.text).toContain('android:required="false"');
  });
});
