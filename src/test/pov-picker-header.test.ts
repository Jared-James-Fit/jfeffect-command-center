import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("client POV switch picker header", () => {
  const picker = readFileSync("src/components/client-pov-quick-picker.tsx", "utf8");
  const command = readFileSync("src/components/ui/command.tsx", "utf8");

  it("suppresses the floating dialog back button and uses an in-flow header", () => {
    expect(picker).toContain("showBackButton={false}");
    expect(picker).toContain("Switch client POV");
    expect(picker).toContain('<span>Back</span>');
    expect(picker).toContain('placeholder="Search clients…"');
  });

  it("lets command dialogs opt out of the default back control", () => {
    expect(command).toContain("showBackButton?: boolean");
    expect(command).toContain("showBackButton={showBackButton}");
  });
});
