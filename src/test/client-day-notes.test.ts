import { describe, expect, it } from "vitest";
import { formatClientDayNotes } from "@/lib/workout-day-label";

describe("formatClientDayNotes", () => {
  it("hides notes the coach did not mark client-visible", () => {
    expect(formatClientDayNotes({ notes: "Private coach note", notes_client_visible: false })).toBeNull();
    expect(formatClientDayNotes({ notes: "Private coach note", notes_client_visible: null })).toBeNull();
    expect(formatClientDayNotes({ notes: "Private coach note" })).toBeNull();
    expect(formatClientDayNotes(null)).toBeNull();
  });

  it("returns nothing for empty visible notes", () => {
    expect(formatClientDayNotes({ notes: "   ", notes_client_visible: true })).toBeNull();
  });

  it("splits the lead paragraph from the optional detail", () => {
    expect(
      formatClientDayNotes({
        notes: "Today's flow: Rack → Dumbbells → Cable.\n\nHow to progress: add reps first.\n\nThen add load.",
        notes_client_visible: true,
      }),
    ).toEqual({
      lead: "Today's flow: Rack → Dumbbells → Cable.",
      detail: "How to progress: add reps first.\n\nThen add load.",
    });
  });

  it("keeps single-paragraph notes as the lead only", () => {
    expect(formatClientDayNotes({ notes: "Finish each station first.", notes_client_visible: true })).toEqual({
      lead: "Finish each station first.",
      detail: null,
    });
  });
});
