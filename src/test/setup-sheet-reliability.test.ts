import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  draftChanged,
  draftFromSetup,
  revealDelta,
  savedForm,
  settingInputMode,
  switchPlan,
  type SetupDraft,
} from "@/lib/equipment/setup-draft";
import { noAutofill } from "@/lib/no-autofill";

// The exercise Setup sheet: what's on screen is compared with what's saved so
// only real changes are sent (Nov 26 2026: it saves as it's changed, nothing
// asks before closing, a change that can't be sent waits on the phone), the
// sheet stays put over the iOS keyboard, and nothing in it ever drives the
// workout card behind it.

const read = (p: string) => readFileSync(p, "utf8");
const saved = (settings: Array<[string, string]>, notes: string | null = null, photo: string | null = null) => ({
  settings: settings.map(([label, value]) => ({ label, value })),
  notes,
  photo_path: photo,
  photo_paths: photo ? [photo] : [],
});

describe("what counts as a change", () => {
  const base = draftFromSetup("rack", saved([["J-hooks", "9"]]));
  it("offers the equipment's usual settings, empty, after what's saved (J-hooks is the rack height)", () => {
    expect(base.fields).toEqual([
      { label: "J-hooks", value: "9" },
      { label: "Safety height", value: "" },
    ]);
  });
  it("an offered setting left empty, a renamed empty label or spaces in the note change nothing", () => {
    expect(draftChanged({ ...base, fields: [...base.fields, { label: "Bench", value: "" }] }, base)).toBe(false);
    expect(draftChanged({ ...base, fields: [{ label: "J-hooks", value: "9" }, { label: "Safety pins", value: "" }] }, base)).toBe(false);
    expect(draftChanged({ ...base, notes: "   " }, base)).toBe(false);
    expect(draftChanged({ ...base, fields: [{ label: "J-hooks", value: " 9 " }, { label: "Safety height", value: "" }] }, base)).toBe(false);
  });
  it("a value, a note or a photo is a change; typing it back is not", () => {
    const typed: SetupDraft = { ...base, fields: [{ label: "J-hooks", value: "9" }, { label: "Safety height", value: "4" }] };
    expect(draftChanged(typed, base)).toBe(true);
    expect(draftChanged({ ...base, notes: "feet on the line" }, base)).toBe(true);
    expect(draftChanged({ ...base, photos: ["c1/p.jpg"] }, base)).toBe(true);
    expect(draftChanged({ ...typed, fields: [{ label: "J-hooks", value: "9" }, { label: "Safety height", value: "" }] }, base)).toBe(false);
  });
  it("saves only labelled values, the note trimmed", () => {
    expect(savedForm({ fields: [{ label: "J-hooks", value: "9" }, { label: "Safeties", value: "" }, { label: "", value: "3" }], notes: "  ok ", photos: [] })).toEqual({
      settings: [{ label: "J-hooks", value: "9" }],
      notes: "ok",
      photos: [],
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
  it("saves as it's changed: one autosave per open sheet, a change goes to it, a flush on the way out", () => {
    expect(sheet).toContain("createAutosave<Snap>({");
    expect(sheet).toContain("a.change({ form, eqId: on, outbox: outboxKey(clientId, exercise.id, on), at: Date.now() }, versionKey(on, d));");
    // closing never loses a change, and never asks
    expect(sheet).toContain("void a.flush();");
    expect(sheet).not.toContain("data-setup-confirm-save");
    expect(sheet).not.toContain("AlertDialog");
    expect(sheet).toContain("onOpenChange={(o) => (o ? onOpenChange(true) : void close())}");
  });
  it("a change is kept on the phone before it's sent, and let go only once the server has it", () => {
    expect(sheet).toMatch(/putOutbox\(\{ clientId, exerciseId: exercise\.id, equipmentId: snap\.eqId, \.\.\.snap\.form, at: snap\.at \}\);\s+await actionsRef\.current\.saveSetup\(/);
    expect(sheet).toMatch(/await actionsRef\.current\.saveSetup\([\s\S]{0,300}\}\);\s+dropOutbox\(snap\.outbox, snap\.at\);/);
    // the app going to the background keeps what's waiting and sends it
    expect(sheet).toContain('window.addEventListener("pagehide", now);');
  });
  it("is pinned to the visible part of the screen while the keyboard is up, never offset by the keyboard's height", () => {
    expect(sheet).not.toContain("var(--keyboard-inset");
    expect(sheet).toContain("const vv = useVisualViewportBox(open);");
    expect(sheet).toContain('style={kb && vv ? { top: vv.top + 8, bottom: "auto", height: vv.height - 8, maxHeight: "none" }');
    // with the keyboard up a pull down takes the keyboard down, never the sheet
    expect(sheet).toContain("swipeToClose={!kb}");
  });
  it("keeps its own place while open: a refetch never resets the view, the equipment or what's being typed", () => {
    expect(sheet).toContain("if (open && !wasOpen.current) {");
    expect(sheet).toContain("if (auto.current?.busy()) return;");
    // our own save coming back moves nothing on screen; another change keeps the rows' ids
    expect(sheet).toContain("// our own save coming back: the same thing, nothing on screen moves");
    expect(sheet).toContain("setRows((cur) => mergeRows(cur, fresh.fields));");
  });
  it("rows keep their own keys, so removing one never moves the box being typed in", () => {
    expect(sheet).toContain("key={f.id}");
    expect(sheet).not.toContain("<li key={i}");
  });
  it("photos are never deleted when taken off a setup: an earlier version can bring them back", () => {
    expect(sheet).not.toContain("removeEquipmentPhoto(");
    const photo = read("src/components/equipment/equipment-photo.tsx");
    expect(photo).not.toContain("removeEquipmentPhoto(");
  });
  it("earlier versions are one tap from back, and a restore can be undone", () => {
    expect(sheet).toContain("data-setup-history");
    expect(sheet).toContain("await actions.restoreSetup(r.id, exercise.id);");
    expect(sheet).toMatch(/x\.reason === "restore"/);
  });
});

describe("the card behind never takes the sheet's touches", () => {
  it("swipe-to-reveal ignores touches and clicks that reach it through a portal", () => {
    const swipe = read("src/components/workout-day/swipe-to-reveal.tsx");
    expect(swipe).toContain("if (!root || !(el instanceof Node) || !root.contains(el)) return true;");
    expect(swipe).toContain("if (!rootRef.current?.contains(e.target as Node)) return;");
  });
});
