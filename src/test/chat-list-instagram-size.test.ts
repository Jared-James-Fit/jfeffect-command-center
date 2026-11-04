import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHAT_ROW_AVATAR, ChatListRow, chatAge } from "@/components/messages/chat-list-row";

const read = (p: string) => readFileSync(p, "utf8");
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const row = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(ChatListRow, {
      avatar: createElement("span", { "data-face": true }),
      name: "Marc",
      preview: "See you Tuesday",
      at: ago(5 * 60_000 + 5_000),
      ...props,
    } as any),
  );

describe("chat lists are Instagram's size", () => {
  it("a 56px face, a 16px name, a 15px preview with its age, ~72px rows and no dividers", () => {
    expect(CHAT_ROW_AVATAR).toBe(56);
    const html = row();
    expect(html).toContain("min-h-[72px]");
    expect(html).toContain("text-[16px]");
    expect(html).toContain("text-[15px]");
    expect(html).toContain("> · 5m</span>");
    expect(html).not.toContain("border-b");
  });

  it("read: regular name, grey preview, no dot; unread: semibold name and preview, a blue dot", () => {
    const read = row();
    expect(read).toContain("font-normal");
    expect(read).toContain("text-muted-foreground");
    expect(read).not.toContain("data-chat-unread");
    const unread = row({ unread: true, unreadLabel: "3 unread messages" });
    expect(unread).toContain("data-chat-unread");
    expect(unread).toContain("bg-[#0095F6]");
    expect(unread).toContain('aria-label="3 unread messages"');
    expect(unread).not.toContain("bg-primary");
    expect(row({ unread: true, dot: false })).not.toContain("data-chat-unread");
  });

  it("the age stays grey and regular even on an unread chat, like Instagram's \"2 new messages · 1m\"", () => {
    const unread = row({ unread: true });
    expect(unread).toMatch(/class="shrink-0 whitespace-pre font-normal text-muted-foreground" data-chat-age="true"> · 5m</);
  });

  it("filter chips are Instagram's: the one you're on is a grey fill, never the brand red", () => {
    const admin = read("src/route-pages/_authenticated/admin/messages.tsx");
    expect(admin).toContain('on ? "border-transparent bg-secondary" : "border-border bg-background hover:bg-secondary/60"');
    expect(admin).not.toContain('"bg-primary-foreground/25 text-primary-foreground"');
    const pane = read("src/components/group-chats-pane.tsx");
    expect(pane).toContain('filter === key ? "border-transparent bg-secondary" : "border-border bg-background hover:bg-secondary/60"');
    expect(pane).not.toContain('filter === key ? "border-primary bg-primary');
  });

  it("muted shows the bell; a row holding its own button is a div acting as one", () => {
    expect(row({ muted: true })).toContain('aria-label="Alerts hidden"');
    const div = row({ as: "div" });
    expect(div.startsWith("<div")).toBe(true);
    expect(div).toContain('role="button"');
    expect(row().startsWith("<button")).toBe(true);
  });

  it("the age reads like Instagram's: now, minutes, hours, days, weeks", () => {
    const now = Date.parse("2026-11-04T12:00:00Z");
    const at = (ms: number) => new Date(now - ms).toISOString();
    expect(chatAge(at(20_000), now)).toBe("now");
    expect(chatAge(at(5 * 60_000), now)).toBe("5m");
    expect(chatAge(at(3 * 3_600_000), now)).toBe("3h");
    expect(chatAge(at(2 * 86_400_000), now)).toBe("2d");
    expect(chatAge(at(9 * 86_400_000), now)).toBe("1w");
    expect(chatAge(null, now)).toBe("");
    expect(chatAge("not a date", now)).toBe("");
  });

  it("every chat list uses the one row at the one size", () => {
    const admin = read("src/route-pages/_authenticated/admin/messages.tsx");
    expect(admin).toContain("<ChatListRow");
    expect(admin).toContain("size={CHAT_ROW_AVATAR}");
    expect(admin).not.toContain('className="border-b border-border/60"');
    const pane = read("src/components/group-chats-pane.tsx");
    expect(pane.match(/<ChatListRow/g)?.length).toBe(2); // coach-run groups + the pinned coach chat
    expect(pane).toContain("at={pinned.at}");
    expect(read("src/components/direct-chat.tsx").match(/<ChatListRow/g)?.length).toBe(2); // 1:1s + Requests
    expect(read("src/components/crew-chat.tsx")).toContain("<CrewFaces faces={thread.faces} size={CHAT_ROW_AVATAR} />");
    // the client's pinned coach chat hands the row a time, not a formatted string
    expect(read("src/routes/_authenticated/portal/messages.tsx")).toContain("at: coachLast?.created_at ?? null,");
  });
});
