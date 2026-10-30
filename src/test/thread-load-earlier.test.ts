import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const thread = readFileSync("src/components/message-thread.tsx", "utf8");

describe("Load earlier messages", () => {
  it("stops offering more once a page comes back short (that's the first message ever sent)", () => {
    expect(thread).toContain("const canLoadOlder = !reachedStart && messages.length >= 25;");
    expect(thread).toContain("if (older.length < OLDER_PAGE) setReachedStart(true);");
    // a new conversation starts over
    expect(thread).toMatch(/setOlderMessages\(\[\]\);\s*setReachedStart\(false\);/);
  });
  it("pages from the oldest message loaded, not the oldest shown (superseded form cards are hidden)", () => {
    expect(thread).toContain("const earliest = olderMessages[0] ?? messages[0];");
    expect(thread).not.toContain("const earliest = allMessages[0];");
  });
  it("says where the chat starts instead of a button that loads nothing", () => {
    expect(thread).toContain("data-thread-start");
    expect(thread).toContain('Start of conversation · {format(parseISO(allMessages[0].created_at), "MMM d, yyyy")}');
  });
});
