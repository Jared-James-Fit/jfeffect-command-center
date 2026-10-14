import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(f, "utf8");
const row = read("src/components/message-edit-row.tsx");
const coach = read("src/components/message-thread.tsx");
const group = read("src/components/group-message-thread.tsx");
const css = read("src/styles.css");

describe("editing a message, iMessage style", () => {
  it("is a roomy pill in place: X to cancel, ✓ to save, grows with the text, no iOS zoom", () => {
    expect(row).toContain('aria-label="Cancel edit"');
    expect(row).toContain('aria-label="Save edit"');
    expect(row).toContain("el.style.height = `${el.scrollHeight}px`;");
    expect(row).toContain("max-h-[40vh]");
    expect(row).toContain("text-[16px]");
    // nothing to save until the text actually changes
    expect(row).toContain("const canSave = !!value.trim() && changed && !saving;");
  });

  it("Return is a new line on a phone; Enter saves on a computer; Esc cancels", () => {
    expect(row).toContain('window.matchMedia?.("(hover: hover) and (pointer: fine)").matches');
    expect(row).toContain('if (e.key === "Escape") { e.preventDefault(); onCancel(); return; }');
  });

  it("the coach chat and group chats both use it, opening the keyboard inside the tap", () => {
    for (const src of [coach, group]) {
      expect(src).toContain("<MessageEditRow");
      expect(src).toContain("onClick={() => startEdit(m)}");
      expect(src).toContain("editRowRef.current?.focus();");
      expect(src).toContain('isEditing && "hidden",');
      expect(src).not.toContain("setEditingId(m.id); setEditingBody(m.body);");
    }
  });

  it("the rest of the chat steps back and a tap on it cancels; the composer too", () => {
    expect(css).toContain("[data-editing-thread] > *:not(:has([data-edit-row]))");
    for (const src of [coach, group]) {
      expect(src).toContain('data-editing-thread={editingId ? "" : undefined}');
      expect(src).toContain("onClick={() => { if (editingId && !editSaving) cancelEdit(); }}");
      expect(src).toContain('editingId && "pointer-events-none opacity-30"');
    }
  });

  it("a caption edit shows what it's for", () => {
    expect(coach).toContain('label={mediaAttachments(m).length > 0 ? "Caption" : undefined}');
  });
});
