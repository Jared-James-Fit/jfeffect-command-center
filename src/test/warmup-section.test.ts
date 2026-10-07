import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const { WarmupSection } = await import("@/components/workout-day/final-warmup-input");

const base = { unit: "kg" as const, form: null, onFormChange() {}, onSave() {}, onRemove() {}, canEdit: true, showPrompt: false, hasHistory: true };
const set = { id: "a", load: 140, unit: "kg" as const, reps: 2, rpe: 7 };

describe("WarmupSection render", () => {
  it("lists logged warm-ups with edit/remove while editable", () => {
    const html = renderToStaticMarkup(createElement(WarmupSection, { ...base, sets: [set] }));
    expect(html).toContain("140 kg × 2 · RPE 7");
    expect(html).toContain('aria-label="Edit warm-up"');
    expect(html).toContain('aria-label="Remove warm-up"');
  });
  it("keeps the list but drops edit controls once working sets are logged", () => {
    const html = renderToStaticMarkup(createElement(WarmupSection, { ...base, sets: [set], canEdit: false }));
    expect(html).toContain("140 kg × 2");
    expect(html).not.toContain("Remove warm-up");
  });
  it("shows the one-tap prompt only with no warm-ups and no open form", () => {
    expect(renderToStaticMarkup(createElement(WarmupSection, { ...base, sets: [], showPrompt: true }))).toContain("final warm-up");
    expect(renderToStaticMarkup(createElement(WarmupSection, { ...base, sets: [set], showPrompt: true }))).not.toContain("final-warmup-prompt");
  });
  it("opens the add form from the Add set menu (form='new')", () => {
    const html = renderToStaticMarkup(createElement(WarmupSection, { ...base, sets: [], form: "new" }));
    expect(html).toContain("Add warm-up");
    expect(html).toContain("Not counted in volume, records or points");
  });
  it("edit form pre-fills the logged values", () => {
    const html = renderToStaticMarkup(createElement(WarmupSection, { ...base, sets: [set], form: "a" }));
    expect(html).toContain("Save warm-up");
  });
});
