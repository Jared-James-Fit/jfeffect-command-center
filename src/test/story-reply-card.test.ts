import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, hash, children, ...rest }: any) => createElement("a", { href: `${to}#${hash}`, ...rest }, children),
}));
const { CommunityPostChatCard, PostReplyText, postReplyCard, isJumboEmoji } = await import("@/components/community/post-chat-card");

const read = (p: string) => readFileSync(p, "utf8");
const render = (el: any) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el));

const storyReply = {
  type: "link", kind: "community_post", post_id: "p1", reply: true, story: true,
  name: "Jared", title: "Jared's story", request_note: "Fueling up", thumb_path: null,
};

describe("story / post replies in chat (Instagram style)", () => {
  it("picks the reply card out of a message's attachments, and only a reply", () => {
    expect(postReplyCard([{ type: "image", path: "a.jpg" }, storyReply])).toBe(storyReply);
    expect(postReplyCard([{ ...storyReply, reply: undefined }])).toBeNull(); // a shared post stays a compact card
    expect(postReplyCard([{ ...storyReply, post_id: undefined }])).toBeNull();
    expect(postReplyCard(null)).toBeNull();
  });

  it("one to three emoji go big with no bubble; anything else is a normal bubble", () => {
    for (const t of ["😍", "🤩🤩", "🔥 💪 🙌", "❤️", "👍🏽", "👨‍👩‍👧"]) expect(isJumboEmoji(t), t).toBe(true);
    for (const t of ["", "ok", "😍 nice", "🔥🔥🔥🔥", "1", "#", "lfg 💪"]) expect(isJumboEmoji(t), t).toBe(false);
  });

  it("someone else's reply: 'Replied to your story' over a big 9:16 cover that opens the story", () => {
    const html = render(createElement(CommunityPostChatCard, { att: storyReply, mine: false, staff: true }));
    expect(html).toContain("Replied to your story");
    expect(html).toContain('href="/admin/community#post=p1"');
    expect(html).toContain("aspect-[9/16] w-[136px]");
    expect(html).toContain("Fueling up"); // no photo: the story's words on its own look
  });

  it("my reply: names whose story, lines up on my side; a post (not story) gets a 4:5 cover", () => {
    const html = render(createElement(CommunityPostChatCard, { att: { ...storyReply, name: "Fionna" }, mine: true, staff: false }));
    expect(html).toContain("You replied to Fionna&#x27;s story");
    expect(html).toContain('href="/portal/community#post=p1"');
    expect(html).toContain("flex-row-reverse");
    const post = render(createElement(CommunityPostChatCard, { att: { ...storyReply, story: false }, mine: false, staff: false }));
    expect(post).toContain("Replied to your post");
    expect(post).toContain("aspect-[4/5] w-[168px]");
  });

  it("the words under the cover: jumbo emoji or their own bubble", () => {
    const emoji = renderToStaticMarkup(createElement(PostReplyText, { body: " 😍 ", mine: false, children: "😍" }));
    expect(emoji).toContain("data-jumbo-emoji");
    expect(emoji).toContain("text-[44px]");
    const text = renderToStaticMarkup(createElement(PostReplyText, { body: "let's go", mine: true, children: "let's go" }));
    expect(text).not.toContain("data-jumbo-emoji");
    expect(text).toContain("bg-primary");
  });

  it("a photo that won't load falls back to the words instead of a broken image", () => {
    const card = read("src/components/community/post-chat-card.tsx");
    expect(card).toContain("onError={() => setBroken(thumb)}");
    expect(card).toContain("const thumb = signed && signed !== broken ? signed : null;");
  });

  it("both chats lead with the card, drop the bubble behind it, and don't list it again as an attachment", () => {
    for (const f of ["src/components/message-thread.tsx", "src/components/group-message-thread.tsx"]) {
      const t = read(f);
      expect(t, f).toContain("postReplyCard(m.attachments)");
      expect(t, f).toContain("<CommunityPostChatCard att={replyCard} mine={mine}");
      expect(t, f).toContain("<PostReplyText body={m.body} mine={mine}>");
      expect(t, f).toContain("m.attachments?.some((a) => a !== replyCard)");
      expect(t, f).toMatch(/if \(a === replyCard\) return null;|a === replyCard \? null :/);
    }
  });
});
