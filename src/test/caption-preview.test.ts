import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cutPreview, previewLine } from "@/lib/caption-preview";

describe("a caption cut in the feed never reads 'sneaky.… more'", () => {
  it("a period gives way to the ellipsis; a ? or ! keeps its mark with a space; an emoji stays", () => {
    expect(cutPreview("PRs are loud, but creeping strength is sneaky.\n\nThe weight...", 46)).toEqual({ shown: "PRs are loud, but creeping strength is sneaky", gap: "" });
    expect(cutPreview("Why are you walking so fast? Me: this is my pace", 28)).toEqual({ shown: "Why are you walking so fast?", gap: " " });
    expect(cutPreview("It's 6 am 💪 and the rack is free", 12).shown).toBe("It's 6 am 💪");
    expect(previewLine("Signs you're just a guy who trains now:\n\nAlarm goes off", 39)).toBe("Signs you're just a guy who trains now… more");
    expect(previewLine("Wait for it…\n\nThen the bar moved", 12)).toBe("Wait for it… more");
  });

  it("is what the feed's caption shows before … more", () => {
    const cap = readFileSync("src/components/community/note-caption.tsx", "utf8");
    expect(cap).toContain("const preview = cut !== null && cut > 0 ? cutPreview(text, cut) : null;");
    expect(cap).toContain('<span className="text-muted-foreground">{preview?.gap}… </span>');
    // measured as it reads, so a "? … more" never spills onto another line
    expect(cap).toContain("lines(previewLine(text, breaks[mid])) <= limits.cut");
    expect(cap).not.toContain('trimEnd() + "… more"');
    expect(previewLine("Why are you walking so fast? Me: this is my pace", 28)).toBe("Why are you walking so fast? … more");
    expect(previewLine("Strength is sneaky. The rest", 19)).toBe("Strength is sneaky… more");
  });
});
