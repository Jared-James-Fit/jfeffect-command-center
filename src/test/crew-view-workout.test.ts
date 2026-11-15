import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("View workout in Crew: the workout card is the way in (Nov 15 2026)", () => {
  const card = read("src/components/community/post-card.tsx");

  it("on a post's screen the workout is one card whose last row is View workout, not a card plus a separate bar", () => {
    expect(card).toContain("<WorkoutOpenCard post={post} onOpen={() => onOpen(post)} hint={!!openHint}>\n                    <WorkoutHero stats={s} unit={unit} />");
    // the old bar under the card is gone from the page (the card feed and a story's pulse keep theirs)
    expect(card.match(/<ViewWorkoutRow post=\{post\}/g)?.length).toBe(2);
    expect(card).toContain("data-view-workout");
    expect(card).toContain('className={cn("flex h-11 w-full items-center justify-between');
    expect(card).toContain('{prs > 1 ? `${prs} PRs` : "Every exercise"}');
    expect(card).toContain("👇 Tap to see the whole workout");
  });

  it("a tap anywhere on the card opens it once the double-tap window has passed (two taps still ❤️); its row opens at once", () => {
    const tap = card.indexOf('closest?.("[data-workout-open]")');
    const clip = card.indexOf('const clip = (e.target as Element | null)?.closest?.("[data-inline-video]");');
    expect(tap).toBeGreaterThan(0);
    // after the double-tap check and the "bring the first post up" tap, before a clip's own tap
    expect(tap).toBeGreaterThan(card.indexOf("if (now - lastTap.current < 300)"));
    expect(tap).toBeGreaterThan(card.indexOf("const below = belowSnap(articleRef.current);"));
    expect(tap).toBeLessThan(clip);
    expect(card).toContain("singleTimer.current = null;\n        onOpen(post);\n      }, 300);");
    expect(card).toContain("e.stopPropagation();\n            onOpen();");
  });

  it("a film post's workout line is finger-sized without moving anything, with a chevron", () => {
    expect(card).toContain("after:absolute after:-inset-x-1 after:-inset-y-1.5 after:content-['']\" data-page-workout");
    expect(card).toContain('<ChevronRight className="-ml-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />');
  });

  it("the card's numbers show whole: their own widths, a step smaller on a narrow card, a line of their own before anything's cut", () => {
    expect(card).toContain('"@container relative overflow-hidden bg-muted px-5 text-foreground"');
    expect(card).toContain('nums.length === 3 ? "flex flex-wrap justify-between gap-x-3 gap-y-3" : "grid grid-cols-2"');
    expect(card).toContain('big ? "text-[30px] @max-[16rem]:text-[24px]" : "text-[24px] @max-[15rem]:text-[20px]"');
    expect(card).toContain('big ? "text-[54px] @max-[16rem]:text-[44px]" : "text-[42px]"');
  });

  it("the workout page doesn't repeat the card: under it only what it doesn't say (PRs, This month); a picture's page keeps every tile", () => {
    const detail = read("src/components/community/post-detail.tsx");
    expect(detail).toContain('const heroStats = !!s && !auto && !(post.kind === "note" && !photo) && !post.media_type;');
    for (const label of ["Time", "Sets", "Volume"]) expect(detail).toMatch(new RegExp(`!heroStats && [^\\n]+label: "${label}"`));
    expect(detail).toContain('s.pr_count > 0 && { label: s.pr_count === 1 ? "PR" : "PRs"');
    expect(detail).toContain('(s.month_sessions ?? 0) > 0 && { label: "This month"');
    expect(detail).toContain('tiles.length <= 2 ? "grid-cols-2" : "grid-cols-3"');
    // the exercises, the reactions and the comments are still all there
    expect(detail).toContain("post.exercises.map((e, i) =>");
    expect(detail).toContain("<CommentThread post={post} viewerIsStaff={viewerIsStaff} inline onOpenAuthor={onOpenAuthor} />");
  });
});
