import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");
const workflow = read(".github/workflows/ios-build.yml");

describe("the iPhone build carries the App Store's privacy pieces", () => {
  it("ships the app privacy manifest from outside ios/ (which the build deletes) and checks it in the built app", () => {
    expect(existsSync("native/ios-app/PrivacyInfo.xcprivacy")).toBe(true);
    expect(existsSync("ios/App/App/PrivacyInfo.xcprivacy")).toBe(false);
    const add = workflow.indexOf("cp native/ios-app/PrivacyInfo.xcprivacy ios/App/App/PrivacyInfo.xcprivacy");
    expect(add).toBeGreaterThan(workflow.indexOf("npx cap add ios"));
    expect(add).toBeLessThan(workflow.indexOf("pod install"));
    expect(workflow).toContain("target.resources_build_phase.add_file_reference(ref, true)");
    expect(workflow).toContain('[ -f "$APP/PrivacyInfo.xcprivacy" ]');
  });

  it("the manifest says no tracking and declares what the app collects", () => {
    const m = read("native/ios-app/PrivacyInfo.xcprivacy");
    expect(m).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
    expect(m).not.toMatch(/<key>NSPrivacyCollectedDataTypeTracking<\/key>\s*<true\/>/);
    for (const t of ["Name", "EmailAddress", "Health", "Fitness", "PhotosorVideos", "AudioData", "EmailsOrTextMessages", "UserID", "CoarseLocation"]) {
      expect(m).toContain(`NSPrivacyCollectedDataType${t}<`);
    }
  });

  it("sets a purpose string for each permission the web page can ask for, on every build", () => {
    for (const k of ["NSCameraUsageDescription", "NSMicrophoneUsageDescription", "NSPhotoLibraryUsageDescription", "NSPhotoLibraryAddUsageDescription", "NSHealthShareUsageDescription", "NSHealthUpdateUsageDescription"]) {
      expect(workflow).toContain(`"${k}"`);
    }
    expect(workflow).not.toContain("This permission is listed because the health library supports it");
  });
});

describe("the App Store build never points to an outside purchase (3.1.1 / 3.1.3)", () => {
  it("no 'at jfeffect.com' or 'on the web' purchase wording on native screens", () => {
    for (const p of ["src/components/upgrade-cta.tsx", "src/routes/_authenticated/portal/plan.tsx", "src/routes/_authenticated/portal/membership.tsx"]) {
      const s = read(p);
      expect(s, p).not.toMatch(/Available at jfeffect\.com|on the web at jfeffect\.com|Manage billing at jfeffect\.com|handled at jfeffect\.com/);
    }
  });

  it("a failed page never shows a stack trace outside development", () => {
    expect(read("src/components/router-error-fallback.tsx")).toContain("import.meta.env.DEV && error.stack");
  });
});
