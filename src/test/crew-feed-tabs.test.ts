import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { onNewVisit, rollFeedAnchor } from "@/lib/feed-anchor";

const read = (p: string) => readFileSync(p, "utf8");

/**
 * Nov 17 2026: the coach wanted the Following system to do more, TikTok's way:
 * a switch at the top between the whole crew and just the people you follow,
 * with the feed always going back to the crew. It used to be a ⌄ on the JF
 * Effect name that only showed once you followed someone.
 */
describe("Crew · Following tabs", () => {
  const screen = read("src/components/community/community-screen.tsx");
  const bar = read("src/components/community/crew-header.tsx");
  const css = read("src/styles.css");

  it("are two tabs in the middle of Crew's bar, the one you're on underlined", () => {
    expect(bar).toContain('role="tablist" aria-label="Feed"');
    expect(bar).toContain('role="tab"');
    expect(bar).toContain("aria-selected={on}");
    expect(bar).toContain('on ? "scale-x-100 opacity-100" : "scale-x-0 opacity-0"');
    // both bold, so picking one never shifts the other
    expect(bar).toContain("text-[17px] font-bold");
    // neutral, never the brand red
    expect(bar).not.toMatch(/data-crew-feed-tab[\s\S]{0,400}text-primary/);
    // over the paged feed's posts they get the icons' soft shadow
    expect(css).toContain(".crew-bar[data-overlay] :is(svg, [data-crew-feed-tab])");
  });

  it("always open on Crew, and a new visit puts them back there", () => {
    expect(screen).toContain('const [feedTab, setFeedTab] = useState<CrewFeedTab>("crew");');
    expect(screen).toContain('useEffect(() => onNewVisit(() => setFeedTab("crew")), []);');
    // never remembered on the phone or the account
    expect(screen).not.toMatch(/localStorage[^\n]*feedTab|feedTab[^\n]*localStorage/);
  });

  it("a new visit tells whoever's listening (a tap on Crew, the New posts pill, 30 minutes away)", () => {
    const fn = vi.fn();
    const off = onNewVisit(fn);
    rollFeedAnchor();
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    rollFeedAnchor();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("Following is the people you follow; following nobody shows the way to people, never your own posts alone", () => {
    expect(screen).toContain("const followsNobody = following && followingIds.size === 0;");
    expect(screen).toContain(
      "followingIds.size === 0 ? [] : ownPosts.filter((p) => inFollowingFeed(p, followingIds))",
    );
    expect(screen).toContain('title="Follow people to fill this feed"');
    // and never reads the whole crew's history looking for posts that can't be there
    expect(screen).toContain(
      'if (!el || !hasNextPage || scope.kind !== "feed" || followsNobody) return;',
    );
    // still reading older pages for their posts: a spinner, not "nothing yet"
    expect(screen).toContain("looking={!!hasNextPage}");
  });

  it("a tap on the tab you're on goes to its top; a preview never shows the coach's own follows", () => {
    expect(screen).toContain(
      'if (t === feedTab) return window.scrollTo({ top: 0, behavior: "smooth" });',
    );
    expect(screen).toContain('if (t === "following" && previewOnly) return void toast(');
  });
});
