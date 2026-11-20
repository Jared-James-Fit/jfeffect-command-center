import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  DRAFT_KEEP_MS,
  draftChanged,
  draftFromSetup,
  draftKey,
  forgetDraft,
  keepDraft,
  parseKept,
  readKeptDraft,
  revealDelta,
  savedForm,
  settingInputMode,
  switchPlan,
  type SetupDraft,
} from "@/lib/equipment/setup-draft";
import { noAutofill } from "@/lib/no-autofill";

// The exercise Setup sheet (Nov 20 2026): what's typed is a draft until Done
// saves it, an exit with changes asks first, the sheet stays put over the iOS
// keyboard, and nothing in it ever drives the workout card behind it.

const read = (p: string) => readFileSync(p, "utf8");
const saved = (settings: Array<[string, string]>, notes: string | null = null, photo: string | null = null) => ({
  settings: settings.map(([label, value]) => ({ label, value })),
  notes,
  photo_path: photo,
});

describe("what counts as a change", () => {
  const base = draftFromSetup("rack", saved([["J-hooks", "9"]]));
  it("offers the kind's usual settings, empty, after what's saved", () => {
    expect(base.fields).toEqual([
      { label: "J-hooks", value: "9" },
      { label: "Safeties", value: "" },
    ]);
  });
  it("an offered setting left empty, a renamed empty label or spaces in the note change nothing", () => {
    expect(draftChanged({ ...base, fields: [...base.fields, { label: "Bench", value: "" }] }, base)).toBe(false);
    expect(draftChanged({ ...base, fields: [{ label: "J-hooks", value: "9" }, { label: "Safety pins", value: "" }] }, base)).toBe(false);
    expect(draftChanged({ ...base, notes: "   " }, base)).toBe(false);
    expect(draftChanged({ ...base, fields: [{ label: "J-hooks", value: " 9 " }, { label: "Safeties", value: "" }] }, base)).toBe(false);
  });
  it("a value, a note or a photo is a change; typing it back is not", () => {
    const typed: SetupDraft = { ...base, fields: [{ label: "J-hooks", value: "9" }, { label: "Safeties", value: "4" }] };
    expect(draftChanged(typed, base)).toBe(true);
    expect(draftChanged({ ...base, notes: "feet on the line" }, base)).toBe(true);
    expect(draftChanged({ ...base, photo: "c1/p.jpg" }, base)).toBe(true);
    expect(draftChanged({ ...typed, fields: [{ label: "J-hooks", value: "9" }, { label: "Safeties", value: "" }] }, base)).toBe(false);
  });
  it("saves only labelled values, the note trimmed", () => {
    expect(savedForm({ fields: [{ label: "J-hooks", value: "9" }, { label: "Safeties", value: "" }, { label: "", value: "3" }], notes: "  ok ", photo: null })).toEqual({
      settings: [{ label: "J-hooks", value: "9" }],
      notes: "ok",
      photo: null,
    });
  });
});

describe("the keyboard a setting gets", () => {
  it("the number pad for the settings that are numbers (every one typed into a note so far was)", () => {
    for (const label of ["J-hooks", "Safeties", "Seat", "Back pad", "Pulley height", "Incline", "Speed", "Rack height", "Pins", "Hole", "Setting"]) {
      expect(settingInputMode(label, ""), label).toBe("decimal");
      expect(settingInputMode(label, "2.5"), label).toBe("decimal");
    }
  });
  it("the full keyboard for words: an attachment, a grip, a label of their own, a value with letters", () => {
    expect(settingInputMode("Attachment", "")).toBe("text");
    expect(settingInputMode("Grip", "")).toBe("text");
    expect(settingInputMode("", "")).toBe("text");
    expect(settingInputMode("Hole", "9a")).toBe("text");
    expect(settingInputMode("Seat", "Low")).toBe("text");
  });
});

describe("switching equipment with changes", () => {
  it("nothing typed: just switch", () => {
    expect(switchPlan({ dirty: false, fromId: null, targetHasSetup: false })).toBe("switch");
  });
  it("typed on 'nothing in particular', picking a rack with no setup yet: the settings go with the pick", () => {
    expect(switchPlan({ dirty: true, fromId: null, targetHasSetup: false })).toBe("carry");
  });
  it("one machine's settings never land on another: saved where they were typed first", () => {
    expect(switchPlan({ dirty: true, fromId: "rack-a", targetHasSetup: false })).toBe("save");
    expect(switchPlan({ dirty: true, fromId: null, targetHasSetup: true })).toBe("save");
  });
});

// the phone's storage, for a node test run
const mem = new Map<string, string>();
const localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
};
(globalThis as any).window ??= {};
(globalThis as any).window.localStorage = localStorage;

describe("a draft an interruption cut short", () => {
  const d: SetupDraft = { fields: [{ label: "J-hooks", value: "11" }], notes: "", photo: null };
  afterEach(() => localStorage.clear());
  it("comes back while it's fresh and typed over the setup as saved now", () => {
    const k = draftKey("c1", "ex1", "eq1");
    keepDraft(k, d, "2026-11-20T10:00:00Z");
    expect(readKeptDraft(k, "2026-11-20T10:00:00Z")).toEqual(d);
  });
  it("one typed over an older version (the coach changed it since) is let go, never saved over the newer one", () => {
    const k = draftKey("c1", "ex1", null);
    keepDraft(k, d, "2026-11-20T10:00:00Z");
    expect(readKeptDraft(k, "2026-11-20T11:00:00Z")).toBeNull();
    expect(localStorage.getItem(k)).toBeNull();
  });
  it("a day old is abandoned, not interrupted", () => {
    const raw = JSON.stringify({ draft: d, base: null, at: 1_000 });
    expect(parseKept(raw, null, 1_000 + DRAFT_KEEP_MS - 1)).toEqual(d);
    expect(parseKept(raw, null, 1_000 + DRAFT_KEEP_MS + 1)).toBeNull();
    expect(parseKept("not json", null, 0)).toBeNull();
  });
  it("is kept per athlete, exercise and equipment", () => {
    expect(draftKey("c1", "ex1", null)).not.toBe(draftKey("c1", "ex1", "eq1"));
    keepDraft(draftKey("c1", "ex1", "eq1"), d, null);
    forgetDraft(draftKey("c1", "ex1", "eq1"));
    expect(readKeptDraft(draftKey("c1", "ex1", "eq1"), null)).toBeNull();
  });
});

describe("the field being typed in stays in view", () => {
  it("scrolls just enough, never past the field's top", () => {
    expect(revealDelta({ top: 100, bottom: 144, viewTop: 0, viewBottom: 400 })).toBe(0);
    expect(revealDelta({ top: 380, bottom: 424, viewTop: 0, viewBottom: 400 })).toBe(36);
    expect(revealDelta({ top: -20, bottom: 24, viewTop: 0, viewBottom: 400 })).toBe(-32);
    // a field taller than the box: its top shows
    expect(revealDelta({ top: 50, bottom: 600, viewTop: 0, viewBottom: 400 })).toBe(38);
  });
});

describe("no contact AutoFill on these boxes", () => {
  it("a name with 'search' (Safari leaves those alone), autocomplete off, password managers out", () => {
    expect(noAutofill("setup-value-0")).toMatchObject({ name: "search-setup-value-0", autoComplete: "off", "data-1p-ignore": "true" });
  });
  it("no box in the sheet or the equipment form is labelled 'name'", () => {
    const sheet = read("src/components/equipment/setup-sheet.tsx");
    const form = read("src/components/equipment/equipment-form.tsx");
    expect(sheet).not.toMatch(/aria-label=\{`Setting \$\{i \+ 1\} name`\}/);
    expect(form).not.toContain('htmlFor="eq-name"');
    expect(form).toContain('{...noAutofill("equipment-title")}');
    expect(sheet).toContain("{...noAutofill(`setup-label-${i}`)}");
    expect(sheet).toContain("{...noAutofill(`setup-value-${i}`)}");
    expect(sheet).toContain('{...noAutofill("setup-note")}');
  });
});

describe("the setup sheet", () => {
  const sheet = read("src/components/equipment/setup-sheet.tsx");
  it("never saves half-typed: no autosave timer, Done saves and closes, one save at a time", () => {
    expect(sheet).not.toContain("SAVE_DELAY_MS");
    expect(sheet).toContain("if (saving.current) return saving.current;");
    expect(sheet).toContain('onClick={() => void finish()}');
    expect(sheet).toContain('toast.success("Setup saved");');
    // "Saved" only once the server has it
    expect(sheet).toMatch(/await actions\.saveSetup\([\s\S]{0,1400}setSaveState\("saved"\)/);
  });
  it("any other way out with changes asks: Save changes, Discard changes, Keep editing", () => {
    expect(sheet).toContain("onOpenChange={(o) => (o ? onOpenChange(true) : requestClose())}");
    expect(sheet).toContain("data-setup-confirm-save");
    expect(sheet).toContain("data-setup-confirm-discard");
    expect(sheet).toContain("data-setup-confirm-keep");
    // a swipe that didn't close is put back
    expect(sheet).toContain('el.style.transform = "";');
  });
  it("is pinned to the visible part of the screen while the keyboard is up, never offset by the keyboard's height", () => {
    expect(sheet).not.toContain("var(--keyboard-inset");
    expect(sheet).toContain("const vv = useVisualViewportBox(open);");
    expect(sheet).toContain('style={kb && vv ? { top: vv.top + 8, bottom: "auto", height: vv.height - 8, maxHeight: "none" }');
    // with the keyboard up a pull down takes the keyboard down, never the sheet
    expect(sheet).toContain("swipeToClose={!kb}");
  });
  it("keeps its own place while open: a refetch never resets the view or the equipment", () => {
    expect(sheet).toContain("if (open && !wasOpen.current) {");
    expect(sheet).toContain("if (same && (latest.current.dirty || saving.current)) return;");
  });
  it("rows keep their own keys, so removing one never moves the box being typed in", () => {
    expect(sheet).toContain("key={f.id}");
    expect(sheet).not.toContain("<li key={i}");
  });
  it("the photo slot never deletes a file itself (a draft can still be discarded)", () => {
    const photo = read("src/components/equipment/equipment-photo.tsx");
    expect(photo).not.toContain("removeEquipmentPhoto(");
    expect(sheet).toContain("if (before && before !== form.photo) void removeEquipmentPhoto(before);");
  });
});

describe("the card behind never takes the sheet's touches", () => {
  it("swipe-to-reveal ignores touches and clicks that reach it through a portal", () => {
    const swipe = read("src/components/workout-day/swipe-to-reveal.tsx");
    expect(swipe).toContain("if (!root || !(el instanceof Node) || !root.contains(el)) return true;");
    expect(swipe).toContain("if (!rootRef.current?.contains(e.target as Node)) return;");
  });
});
