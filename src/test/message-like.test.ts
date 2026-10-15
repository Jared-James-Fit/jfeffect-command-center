import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { doubleTapAdds } from "@/lib/message-like";
import { ALLOWED_REACTIONS, DEFAULT_REACTION } from "@/lib/chat-settings";
import { REACTION_EMOJIS } from "@/lib/messages";
import { GROUP_REACTION_EMOJIS } from "@/lib/group-chats";

const read = (p: string) => readFileSync(p, "utf8");

describe("liking a message, Instagram style", () => {
  it("is a heart by default, first in every reaction bar", () => {
    expect(DEFAULT_REACTION).toBe("❤️");
    expect(ALLOWED_REACTIONS[0]).toBe("❤️");
    expect(REACTION_EMOJIS[0]).toBe("❤️");
    expect(GROUP_REACTION_EMOJIS[0]).toBe("❤️");
    // the same choices everywhere, so a reaction picked in one chat shows in the others
    expect([...REACTION_EMOJIS].sort()).toEqual([...ALLOWED_REACTIONS].sort());
    expect([...GROUP_REACTION_EMOJIS].sort()).toEqual([...ALLOWED_REACTIONS].sort());
  });

  it("a double-tap adds the heart or switches yours to it, and never takes it back", () => {
    expect(doubleTapAdds([], "❤️")).toBe(true);
    expect(doubleTapAdds([{ emoji: "🔥" }], "❤️")).toBe(true);
    expect(doubleTapAdds([{ emoji: "❤️" }], "❤️")).toBe(false);
  });

  it("goes through the like path (springy heart) in the coach chat and the group / 1:1 chats", () => {
    for (const f of ["src/components/message-thread.tsx", "src/components/group-message-thread.tsx"]) {
      const src = read(f);
      // touch double-tap and desktop double-click both like, neither toggles
      expect(src.match(/onDoubleTapLike\(m\.id\);/g)?.length, f).toBe(2);
      expect(src, f).not.toContain("void onToggleReaction(m.id, defaultReaction);");
      expect(src, f).toContain("if (doubleTapAdds(mine, defaultReaction)) onToggleReaction(messageId, defaultReaction);");
      expect(src, f).toContain('popping ? "animate-like-pop" : "animate-reaction-pop"');
      expect(src, f).toContain('haptic("light");');
    }
    expect(read("src/styles.css")).toContain("@keyframes like-pop");
  });
});
