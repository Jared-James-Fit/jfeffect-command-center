import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { clientTrainingHref, editorBackPlan } from "@/lib/editor-back";

const read = (p: string) => readFileSync(p, "utf8");

describe("the program editor's ← goes back to where the coach came from", () => {
  it("history first, the place it belongs only when opened cold", () => {
    expect(editorBackPlan(true, "/admin/clients/c1?tab=training")).toEqual({ kind: "history" });
    expect(editorBackPlan(false, "/admin/clients/c1?tab=training")).toEqual({
      kind: "fallback",
      href: "/admin/clients/c1?tab=training",
    });
    expect(clientTrainingHref("c1")).toBe("/admin/clients/c1?tab=training");
  });

  it("the block editor's back is the history-aware button, never a link to the profile's Summary", () => {
    const src = read("src/routes/_authenticated/admin/blocks.$blockId.tsx");
    expect(src).toContain("useEditorBack({");
    expect(src).toContain("clientTrainingHref(clientIdFromTree)");
    // saving first, so leaving never drops an edit
    expect(src).toMatch(/beforeLeave: async \(\) => \{\s*if \(dirty \|\| autosave\.hasPending\(\)\) await save\(\);/);
    const back = src.slice(src.indexOf("back={"), src.indexOf("title={", src.indexOf("back={")));
    expect(back).not.toContain("ClientNameLink");
    expect(back).toContain("goBack()");
  });

  it("the template editor goes back the same way (the library with its search kept)", () => {
    const src = read("src/route-pages/_authenticated/admin/program-library_.$templateId.tsx");
    expect(src).toContain('fallbackHref: "/admin/program-library"');
    const back = src.slice(src.indexOf("back={"), src.indexOf("title={", src.indexOf("back={")));
    expect(back).toContain("goBack()");
    expect(back).not.toContain('to="/admin/program-library"');
  });

  it("switching blocks replaces the editor in history, so ← still leaves the editor", () => {
    expect(read("src/components/block-switcher.tsx")).toMatch(/to: "\/admin\/blocks\/\$blockId", params: \{ blockId \}, replace: true/);
  });

  it("the client overlay keeps its tab in the address, so Back lands on the tab the coach was on", () => {
    const src = read("src/components/clients/profile/client-profile-overlay.tsx");
    expect(src).toContain("onTabChange={setTab}");
    expect(src).toContain('data-scroll-restoration-id="client-profile-overlay"');
    expect(read("src/lib/open-client-profile.ts")).toMatch(/clientTab: tab \}\),\s*replace: true/);
  });
});


describe("account profile overlay preserves the underlying directory", () => {
  it("never resets scroll when opening, closing or changing profile tabs", () => {
    const src = read("src/lib/open-client-profile.ts");
    const calls = src.match(/navigate\(\{[\s\S]*?\} as any\)/g) ?? [];
    expect(calls).toHaveLength(4);
    for (const call of calls) expect(call).toContain("resetScroll: false");
  });

  it("restores trigger focus without scrolling the directory", () => {
    const src = read("src/components/clients/profile/client-profile-overlay.tsx");
    expect(src).toContain("onCloseAutoFocus");
    expect(src).toContain("el.focus({ preventScroll: true })");
  });
});
