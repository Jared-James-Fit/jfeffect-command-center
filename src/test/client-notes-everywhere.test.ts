import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8");

// Nov 11 2026: Quick Notes saved to a client (Colten's nose surgery and two weeks
// off, his moving date) were on his file, but only under More → Coach notes; his
// profile opens on Summary and the chat's Notes showed only what he'd sent.
describe("a client's notes are where the coach looks", () => {
  const profile = read("src/route-pages/_authenticated/admin/clients.$id.tsx");
  const summary = profile.slice(profile.indexOf("function ClientOverviewSnapshot("), profile.indexOf("function FoldedSection("));

  it("first on the Summary, the pinned and newest few", () => {
    expect(summary).toContain("<ClientFileNotes clientId={clientId} limit={3} />");
    expect(summary.indexOf("<ClientFileNotes")).toBeLessThan(summary.indexOf("<ClientCalendarSyncStatus"));
  });

  it("at the top of Notes in their chat, above what they've sent (staff only)", () => {
    const sheet = read("src/components/messages/client-notes-log.tsx");
    expect(sheet).toContain("{clientId && coachNotes && (");
    expect(sheet).toContain("<ClientFileNotes clientId={clientId} limit={3} bare />");
    expect(read("src/route-pages/_authenticated/admin/messages.tsx")).toContain("onClose={() => setNotesOpen(false)} coachNotes />");
    // the workout note card opens the sheet only for staff
    const card = read("src/components/messages/workout-note-card.tsx");
    expect(card.slice(card.indexOf("{staff ? (")).split(") : (")[0]).toContain("coachNotes />");
  });

  it("the card: one title, the rest a tap away, nothing remounted while typing", () => {
    const notes = read("src/components/clients/client-file-notes.tsx");
    expect(notes).toContain("Show all {matching.length}");
    expect(notes).toContain('const Wrap = bare ? "div" : Card;');
    expect(notes).toContain("Only you and your team see these");
    expect(notes).not.toContain("uppercase tracking-widest text-muted-foreground\">\n            <StickyNote");
    // the Archive and search only once it's open
    expect(notes).toContain("{full && archived.length > 0 && (");
    expect(notes).toContain("{full && notes.length > 5 && (");
  });
});
