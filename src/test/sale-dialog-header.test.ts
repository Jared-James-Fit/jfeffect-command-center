import { describe, it, expect } from "vitest";
import {
  SALE_DIALOG_BACK_CLASS,
  SALE_DIALOG_BODY_CLASS,
  SALE_DIALOG_CLOSE_CLASS,
  SALE_DIALOG_CONTENT_CLASS,
  SALE_DIALOG_FOOTER_CLASS,
  SALE_DIALOG_HEADER_CLASS,
  SALE_DIALOG_TITLE_CLASS,
} from "@/lib/sale-dialog-layout";

describe("Add Sale modal header", () => {
  it("lays Back, title and close out in one grid — no absolute positioning", () => {
    expect(SALE_DIALOG_HEADER_CLASS).toContain("grid-cols-[auto_minmax(0,1fr)_auto]");
    expect(SALE_DIALOG_HEADER_CLASS).not.toContain("absolute");
    expect(SALE_DIALOG_BACK_CLASS).not.toContain("absolute");
  });

  it("never re-introduces the padding hack that dodged the floating Back pill", () => {
    expect(SALE_DIALOG_HEADER_CLASS).not.toContain("pl-24");
    // Renders above the client workspace overlay so nothing can cover the title.
    expect(SALE_DIALOG_CONTENT_CLASS).toContain("z-[60]");
  });

  it("keeps the title from clipping Back or close at 320px", () => {
    expect(SALE_DIALOG_TITLE_CLASS).toContain("min-w-0");
    expect(SALE_DIALOG_TITLE_CLASS).toContain("truncate");
    expect(SALE_DIALOG_BACK_CLASS).toContain("shrink-0");
    expect(SALE_DIALOG_CLOSE_CLASS).toContain("shrink-0");
  });

  it("keeps a real touch target on mobile and tablet", () => {
    expect(SALE_DIALOG_BACK_CLASS).toContain("min-h-[44px]");
    expect(SALE_DIALOG_CLOSE_CLASS).toContain("min-h-[44px]");
  });

  it("respects the dynamic island and home indicator", () => {
    expect(SALE_DIALOG_HEADER_CLASS).toContain("env(safe-area-inset-top)");
    expect(SALE_DIALOG_FOOTER_CLASS).toContain("env(safe-area-inset-bottom)");
  });

  it("is a full-screen sheet on mobile and a centred modal from tablet up", () => {
    expect(SALE_DIALOG_CONTENT_CLASS).toContain("h-[100dvh]");
    expect(SALE_DIALOG_CONTENT_CLASS).toContain("sm:max-w-2xl");
    expect(SALE_DIALOG_BODY_CLASS).toContain("overflow-x-hidden");
  });
});
