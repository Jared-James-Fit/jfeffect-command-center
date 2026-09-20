import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("src/components/messages/messenger-checkin-card.tsx", "utf8");

describe("Messenger check-in sheet header", () => {
  it("uses an in-flow Back control instead of the absolute default sheet control", () => {
    const start = source.indexOf("<SheetContent", source.indexOf("function CheckinWizard"));
    const end = source.indexOf("</SheetContent>", start);
    const wizard = source.slice(start, end);
    expect(wizard).toContain("hideCloseButton");
    expect(wizard).toContain("<SheetClose");
    expect(wizard).toContain('<span>Back</span>');
    expect(wizard).toContain("grid-cols-[auto_minmax(0,1fr)_auto]");
  });

  it("keeps the title and step counter in the same header row", () => {
    expect(source).toContain("{titleFor(taskType)}");
    expect(source).toContain("{step + 1} / {visible.length}");
  });
});
