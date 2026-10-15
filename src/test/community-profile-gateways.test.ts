import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(f, "utf8");

describe("ways into a profile (Instagram, TikTok, Strava)", () => {
  it("opens someone's profile from their story: the photo and the name, the story sliding away first", () => {
    const stories = read("src/components/community/crew-stories.tsx");
    expect(stories).toContain("onOpenPerson?: (a: CommunityAuthor) => void;");
    expect(stories).toContain("window.setTimeout(() => onOpenPerson(a), 230);");
    expect(stories).toContain('aria-label={group.mine ? "Open your profile" : `Open ${who.name}\'s profile`} data-story-profile');
    expect(stories).toContain("data-story-profile-name");
    // who saw your story, and who answered its sticker, open the same way
    expect(stories).toContain("<ViewersSheet postId={viewers ? post.id : null} onClose={() => setViewers(false)} onOpenAuthor={onOpenPerson} />");
    expect(stories).toContain("<StorySticker post={post} onComposing={setComposing} onOpenPerson={openPerson} />");
    expect(read("src/components/community/story-sticker.tsx")).toContain("data-sticker-answer-person");
    expect(read("src/components/community/community-screen.tsx")).toContain("onOpenPerson={openAuthor}");
  });

  it("opens a commenter's profile from the comments, in the sheet and on the post page", () => {
    const comments = read("src/components/community/comments-sheet.tsx");
    expect(comments).toContain("onOpenAuthor={onOpenAuthor ? (a) => { onClose(); onOpenAuthor(a); } : undefined}");
    expect(comments).toContain("const toProfile = onOpenAuthor && !c.pending ? () => onOpenAuthor(c.author) : undefined;");
    expect(read("src/components/community/community-screen.tsx")).toContain("onClose={() => setCommentsFor(null)} onOpenAuthor={openAuthor} />");
    expect(read("src/components/community/post-detail.tsx")).toContain("<CommentThread post={post} viewerIsStaff={viewerIsStaff} inline onOpenAuthor={onOpenAuthor} />");
  });

  it("makes your own profile a tab, Feed · Rankings · You with your photo (not while a coach views as a client)", () => {
    const screen = read("src/components/community/community-screen.tsx");
    expect(screen).toContain('type Tab = "feed" | "rankings" | "you" | "members" | "activity";');
    expect(screen).toContain('{((previewOnly ? ["feed", "rankings"] : ["feed", "rankings", "you"]) as Tab[]).map((k) => (');
    expect(screen).toContain('{k === "you" && <MyTabPhoto active={scope.kind === "you"} />}');
    // the tab keeps its place in the URL (#you), and Crew's own button (no hash) brings you back to the feed
    expect(screen).toContain('hash: k === "feed" ? "" : k');
    expect(screen).toContain('else if (!routeHash || routeHash === "feed") setScope((sc) => (sc.kind === "rankings" || sc.kind === "you" ? { kind: "feed" } : sc));');
    // on the coach's Crew page (no tab row) it's a page with a way back
    expect(screen).toContain('const youAsPage = hideTabs && scope.kind === "you";');
    const pv = read("src/components/community/profile-view.tsx");
    expect(pv).toContain('aria-label="Your profile"');
    expect(pv).toContain("<MyTabPhoto />\n      You");
    const hub = read("src/components/community/admin-community-hub.tsx");
    expect(hub).toContain("<MyProfileButton");
    expect(hub).toContain("window.setTimeout(() => openCommunityPerson(id), 0);");
  });

  it("sends your own id to your own profile (edit photo and bio), anyone else's to theirs", () => {
    const screen = read("src/components/community/community-screen.tsx");
    expect(screen).toContain("meRef.current = [user?.id, myId];");
    expect(screen).toContain('return meRef.current.includes(id) ? { kind: "you" } : { kind: "author"');
  });
});
