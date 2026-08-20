import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TOAST_PWA_SAFE_AREA_TOP } from "@/lib/notifications-page-layout";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
const birthdayWidget = readFileSync(
  resolve(process.cwd(), "src/components/upcoming-birthdays-widget.tsx"),
  "utf8",
);

describe("birthday toast safe-area contract", () => {
  it("keeps a status-area fallback when standalone PWA safe-area values arrive late", () => {
    expect(TOAST_PWA_SAFE_AREA_TOP).toContain("max(3.5rem, env(safe-area-inset-top))");
    expect(styles).toContain(`top: ${TOAST_PWA_SAFE_AREA_TOP} !important;`);
  });

  it("keeps the birthday notification content and one-toast-per-day guard unchanged", () => {
    expect(birthdayWidget).toContain("bday-toast:${todayLocalISO()}");
    expect(birthdayWidget).toContain("🎂 Birthday today: ${names}");
    expect(birthdayWidget).toContain("Customize their card or send a message from the dashboard.");
  });
});
