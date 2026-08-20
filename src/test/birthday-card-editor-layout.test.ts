import { describe, expect, it } from "vitest";
import {
  BIRTHDAY_EDITOR_DIALOG_CLASS,
  BIRTHDAY_EDITOR_EDIT_CONTENT_CLASS,
  BIRTHDAY_EDITOR_FOOTER_CLASS,
  BIRTHDAY_EDITOR_HEADER_CLASS,
  BIRTHDAY_EDITOR_PREVIEW_CLASS,
  BIRTHDAY_EDITOR_PREVIEW_CONTENT_CLASS,
  BIRTHDAY_EDITOR_TABS_CLASS,
} from "@/lib/birthday-card-editor-layout";

describe("birthday card editor responsive modal layout", () => {
  it("constrains the dialog as a flex column instead of allowing intrinsic content to escape", () => {
    expect(BIRTHDAY_EDITOR_DIALOG_CLASS).toContain("birthday-card-editor-dialog");
    expect(BIRTHDAY_EDITOR_DIALOG_CLASS).toContain("flex-col");
    expect(BIRTHDAY_EDITOR_DIALOG_CLASS).toContain("overflow-hidden");
  });

  it("keeps the header and footer visible while exactly one tab body scrolls", () => {
    expect(BIRTHDAY_EDITOR_HEADER_CLASS).toContain("shrink-0");
    expect(BIRTHDAY_EDITOR_FOOTER_CLASS).toContain("shrink-0");
    expect(BIRTHDAY_EDITOR_TABS_CLASS).toContain("min-h-0");
    expect(BIRTHDAY_EDITOR_TABS_CLASS).toContain("flex-1");

    for (const region of [BIRTHDAY_EDITOR_EDIT_CONTENT_CLASS, BIRTHDAY_EDITOR_PREVIEW_CONTENT_CLASS]) {
      expect(region).toContain("min-h-0");
      expect(region).toContain("flex-1");
      expect(region).toContain("overflow-y-auto");
      expect(region).toContain("overscroll-contain");
    }
  });

  it("makes preview-only content independently reachable without delegating scroll to the locked page", () => {
    expect(BIRTHDAY_EDITOR_PREVIEW_CLASS).toContain("overflow-y-auto");
    expect(BIRTHDAY_EDITOR_PREVIEW_CLASS).toContain("overscroll-contain");
  });
});
