import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMMENT_MAX } from "@/lib/community";
import { QUICK_COMMENT_EMOJI, insertAtCursor } from "@/lib/comment-composer";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("comments read like Instagram's and TikTok's (Nov 14 2026)", () => {
  it("a quick emoji goes in where the cursor is, never past the limit", () => {
    expect(QUICK_COMMENT_EMOJI).toEqual(["❤️", "🙌", "🔥", "👏", "😢", "😍", "😮", "😂"]);
    expect(insertAtCursor("", "🔥", 0, 0, COMMENT_MAX)).toEqual({ text: "🔥", cursor: 2 });
    // after a word: a space first; after an emoji or a space: none
    expect(insertAtCursor("Strong", "🔥", 6, 6, COMMENT_MAX)).toEqual({ text: "Strong 🔥", cursor: 9 });
    expect(insertAtCursor("Strong 🔥", "🔥", 9, 9, COMMENT_MAX).text).toBe("Strong 🔥🔥");
    expect(insertAtCursor("Strong ", "👏", 7, 7, COMMENT_MAX).text).toBe("Strong 👏");
    // in the middle, replacing a selection; no cursor = at the end
    expect(insertAtCursor("great set", "💪", 0, 0, COMMENT_MAX)).toEqual({ text: "💪great set", cursor: 2 });
    expect(insertAtCursor("great set!", "🙌", 6, 9, COMMENT_MAX).text).toBe("great 🙌!");
    expect(insertAtCursor("nice", "😂", null, null, COMMENT_MAX).text).toBe("nice 😂");
    // full: nothing changes
    const full = "x".repeat(COMMENT_MAX);
    expect(insertAtCursor(full, "🔥", COMMENT_MAX, COMMENT_MAX, COMMENT_MAX)).toEqual({ text: full, cursor: COMMENT_MAX });
  });

  it("the sheet is titled Comments with ✕, and the caption is its first line, written like a comment", () => {
    const sheet = read("src/components/community/post-sheet.tsx");
    expect(sheet).toContain('<Dialog.Title className="mt-2.5 text-center text-[16px] font-semibold leading-6">Comments</Dialog.Title>');
    expect(sheet).toContain('aria-label="Close comments"');
    expect(sheet).toContain("data-post-sheet-caption");
    expect(sheet).toContain("if (!auto && !caption) return null;");
    // no Follow in the sheet: the post's own screen has it
    expect(sheet).not.toContain("InlineFollow");
    const cards = read("src/components/community/comments-sheet.tsx");
    expect(cards).not.toContain("Quick encouragement. Coaching questions belong in Messages.");
  });

  it("a comment: the name and when, the words, Reply under them, the heart with its count on the right", () => {
    const t = read("src/components/community/comments-sheet.tsx");
    expect(t).toContain('const likes = !c.pending && (c.likes ?? 0) > 0 ? compactNumber(c.likes ?? 0) : "";');
    expect(t).toContain("data-comment-likes");
    expect(t).toContain("const size = reply ? 28 : 36;");
    expect(t).not.toContain("likesLabel(");
    expect(t).toContain('<div className="text-[20px] font-semibold leading-7">No comments yet</div>');
    expect(t).toContain("Start the conversation.");
    expect(t).toContain('View {replies.length - shown.length} more {replies.length - shown.length === 1 ? "reply" : "replies"}');
  });

  it("the box: emoji over it, your photo, one rounded box with photo, GIF and mic inside, the arrow once there's something to send", () => {
    const t = read("src/components/community/comments-sheet.tsx");
    expect(t).toContain("data-quick-emoji");
    expect(t).toContain("onPointerDown={(ev) => ev.preventDefault()}");
    expect(t).toContain('<UserAvatar src={me.avatar_url} name={me.name} size={32} expandable={false} className="mb-1.5" />');
    expect(t).toContain("data-comment-box");
    expect(t).toContain("<MicButton onClick={() => void recorder.start()} disabled={!user?.id || picking} quiet />");
    expect(t).toContain("<ArrowUp");
    expect(t).toContain('const placeholder = replyTo ? `Reply to ${replyTo.mine ? "yourself" : replyTo.name.split(" ")[0]}…` : "Add a comment…";');
    // the box stays 16px on a phone (no iOS zoom on focus)
    expect(t).toMatch(/className="[^"]*text-\[16px\][^"]*"\s+aria-label=\{replyTo \? "Write a reply" : "Add a comment"\}/);
    const mic = read("src/components/community/voice-memo.tsx");
    expect(mic).toContain('quiet ? "h-9 w-9 text-muted-foreground hover:text-foreground" : "h-11 w-11 bg-primary text-primary-foreground"');
  });
});
