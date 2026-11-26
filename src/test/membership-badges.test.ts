import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { MembershipEmblem, MembershipBadgeLabel } from "@/components/membership-emblem";
import { BADGE_LABEL, emblemTier, nameMarks } from "@/lib/membership-badge";

describe("membership emblems", () => {
  it("three emblems: coaching gold, member / premium platinum, free graphite", () => {
    expect(emblemTier("coaching")).toBe("coaching");
    expect(emblemTier("premium")).toBe("member");
    expect(emblemTier("member")).toBe("member");
    expect(emblemTier("free")).toBe("free");
    expect(emblemTier(null)).toBeNull();
    expect(emblemTier("gold")).toBeNull();
  });

  it("tells the tiers apart by stroke count and finish, not colour alone", () => {
    const strokes = (b: string) => (renderToStaticMarkup(createElement(MembershipEmblem, { badge: b })).match(/stroke-linecap="round"/g) ?? []).length;
    expect(strokes("free")).toBe(1);
    expect(strokes("member")).toBe(2);
    expect(strokes("coaching")).toBe(3);
    const free = renderToStaticMarkup(createElement(MembershipEmblem, { badge: "free" }));
    expect(free).toContain('fill="none"');
    expect(free).not.toContain("linearGradient");
    expect(renderToStaticMarkup(createElement(MembershipEmblem, { badge: "coaching" }))).toContain("var(--emblem-coach-a)");
  });

  it("is an accessible image by default, decorative beside its own word, and nothing for no badge", () => {
    const html = renderToStaticMarkup(createElement(MembershipEmblem, { badge: "coaching", size: 12 }));
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Coaching membership"');
    expect(html).toContain('width="12"');
    const labelled = renderToStaticMarkup(createElement(MembershipBadgeLabel, { badge: "premium" }));
    expect(labelled).toContain('aria-hidden="true"');
    expect(labelled).toContain("Premium");
    expect(renderToStaticMarkup(createElement(MembershipEmblem, { badge: null }))).toBe("");
  });

  it("an original mark: no crowns, stars, shields or icon-library glyphs", () => {
    const src = readFileSync("src/components/membership-emblem.tsx", "utf8");
    expect(src).not.toMatch(/lucide-react/);
    expect(src).not.toMatch(/Crown|Star|Shield/);
    expect(src).not.toMatch(/animate-|@keyframes/);
  });

  it("has light and dark tokens", () => {
    const css = readFileSync("src/styles.css", "utf8");
    for (const t of ["--emblem-coach-a", "--emblem-member-a", "--emblem-free"]) {
      expect(css.match(new RegExp(`${t}:`, "g"))?.length).toBe(2);
    }
  });

  it("staff get the coach mark instead; virtual is always shown", () => {
    expect(nameMarks({ is_coach: true, badge: "free" })).toEqual({ coach: true, badge: null, virtual: false });
    expect(nameMarks({ badge: "member", virtual: true })).toEqual({ coach: false, badge: "member", virtual: true });
    expect(nameMarks({ badge: "nonsense" }).badge).toBeNull();
    expect(BADGE_LABEL.coaching).toBe("Coaching");
  });
});

describe("the badge is decided from actual access, in one place", () => {
  const sql = readFileSync("supabase/migrations/20270601090000_accounts_directory_badges_pov_virtual.sql", "utf8");
  const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public._membership_badge"), sql.indexOf("REVOKE ALL ON FUNCTION public._membership_badge"));
  it("coaching first, then premium, then a paid or complimentary membership, else free", () => {
    const order = ["'coaching'", "'premium'", "THEN 'member'", "ELSE 'free'"].map((s) => fn.indexOf(s));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(fn).toContain("NOT cp.show_membership_badge");
    expect(fn).toContain("'Complimentary'");
  });
  it("an archived, deactivated or lead record is never a coaching badge", () => {
    expect(fn).toContain("NOT IN ('Deactivated', 'Deleted', 'Lead', 'Archived')");
  });
  it("the author card carries it and the Crew draws it beside every name", () => {
    expect(sql).toContain("'badge', CASE WHEN staff.yes OR cp.title IS NOT NULL THEN NULL ELSE public._membership_badge(me.uid) END");
    for (const f of ["post-card", "comments-sheet", "post-sheet", "profile-view", "reactors-sheet", "crew-list", "discover", "mentions", "suggested-athletes", "crew-stories"]) {
      expect(readFileSync(`src/components/community/${f}.tsx`, "utf8")).toContain("<NameMarks");
    }
    expect(readFileSync("src/components/portal/athlete-level-card.tsx", "utf8")).toContain("<NameMarks userId={r.client_id}");
    expect(readFileSync("src/components/messages/chat-list-row.tsx", "utf8")).toContain("<NameMarks userId={storyUserId}");
  });
});
