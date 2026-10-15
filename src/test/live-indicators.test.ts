import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("live indicators: one animated look across the app", () => {
  const ui = read("src/components/live-indicator.tsx");
  const css = read("src/styles.css");

  it("the dot breathes with two waves; a live avatar gets a turning ring and a LIVE tag; red pills glow; still with reduced motion", () => {
    expect(ui).toContain('"jf-live-wave jf-live-wave-2 absolute inset-0 rounded-full"');
    expect(ui).toContain('"jf-live-core relative inline-flex h-full w-full rounded-full"');
    expect(ui).toContain('"jf-live-ring pointer-events-none absolute rounded-full"');
    for (const k of ["@keyframes jf-live-wave", "@keyframes jf-live-breathe", "@keyframes jf-live-turn", "@keyframes jf-live-pill"]) expect(css).toContain(k);
    expect(css).toContain(".jf-live-wave, .jf-live-core, .jf-live-ring, .jf-live-halo, .jf-live-pill { animation: none; }");
    // the old chat dot now is this one
    expect(read("src/hooks/use-chat-presence.tsx")).toContain('export { LiveDot } from "@/components/live-indicator";');
  });

  it("a pinned chat shows one signal at a time: live (ring + LIVE) or the unread dot, never both", () => {
    const tile = read("src/components/messages/inbox-parts.tsx");
    expect(tile).toContain("<LiveAvatar live={live} size={60}>{avatar}</LiveAvatar>");
    expect(tile).toContain("{unread && !live && <span");
    expect(tile).not.toContain("<LiveDot");
  });

  it("the coach's chat row and header, the coach's inbox header, Rankings and Crew all use it", () => {
    expect(read("src/components/group-chats-pane.tsx")).toContain("<LiveAvatar live={pinned.live} size={44}>");
    expect(read("src/routes/_authenticated/portal/messages.tsx")).toContain("<LiveAvatar live={coachLive} size={40} tag={false}>");
    expect(read("src/route-pages/_authenticated/admin/messages.tsx")).toContain("<LiveAvatar live={selectedClientLive || isClientActive((selected as any).last_active_at)} size={40} tag={false}>");
    expect(read("src/components/community/crew-list.tsx")).toContain('<LiveAvatar live={m.live} size={44} tone="red" tag={false}>');
    expect(read("src/components/community/post-card.tsx")).toContain('<LiveDot size={6} tone="white" ring={false} /> Training now');
    expect(read("src/components/community/community-entry.tsx")).toContain('<LivePill className="shrink-0" />');
    for (const f of ["src/components/community/league-hub.tsx", "src/components/portal/home-league-previews.tsx", "src/components/portal/powerlifting-career.tsx", "src/components/community/post-tile.tsx"]) {
      expect(read(f), f).not.toContain("animate-ping");
      expect(read(f), f).toContain('from "@/components/live-indicator"');
    }
  });

  it("the coach's inbox and group chats show live the way the client's inbox does: the ring, never a small green dot", () => {
    const admin = read("src/route-pages/_authenticated/admin/messages.tsx");
    // each client row: the ring + LIVE tag, like the coach pin in the client's inbox
    expect(admin).toContain("live={isClientActive((client as any).last_active_at) || (client.id === selectedId && selectedClientLive)}");
    expect(admin).not.toContain("<LiveDot");
    expect(admin).toContain('{selectedClientLive ? "Live in chat" : "Active now"}');
    const thread = read("src/components/group-message-thread.tsx");
    expect(thread).toContain("<LiveAvatar live={isLive} size={28} tag={false}>");
    const pane = read("src/components/group-chats-pane.tsx");
    expect(pane).toContain("<LiveAvatar key={m.user_id} live={liveIds.has(m.user_id)} size={32} tag={false}>");
    for (const [f, t] of [["group-message-thread", thread], ["group-chats-pane", pane], ["admin/messages", admin]] as const) {
      expect(t, f).not.toMatch(/rounded-full bg-emerald-500 ring-2/);
    }
  });
});
