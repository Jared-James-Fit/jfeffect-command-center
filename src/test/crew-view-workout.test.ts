import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("The workout in Crew: the post's last swipe, never a page it sends you to (Nov 20 2026, was Nov 15)", () => {
  const card = read("src/components/community/post-card.tsx");

  it("on a post's screen with no picture the workout's card is the first swipe and its recap the second; its row slides there", () => {
    expect(card).toMatch(/<FitScale>\s*<WorkoutCoverCard post=\{post\} onRecap=\{toRecap\}>\s*<WorkoutHero stats=\{s\} unit=\{unit\} \/>/);
    expect(card).not.toContain("WorkoutOpenCard");
    // the old bar under the card is gone from the page (the card feed and a story's pulse keep theirs)
    expect(card.match(/<ViewWorkoutRow post=\{post\}/g)?.length).toBe(2);
    expect(card).toContain("data-view-workout");
    expect(card).toContain('{prs > 1 ? `${prs} PRs · Swipe` : "Every exercise · Swipe"}');
    // the first-time tip is the swipe's ("Swipe for workout" by the carousel's counter), never a bouncing "tap"
    expect(card).not.toContain("👇 Tap to see the whole workout");
    expect(card).toContain("Swipe for workout");
  });

  it("a tap on the card never leaves the post (two taps still ❤️); only its buttons move it, at once", () => {
    expect(card).not.toContain('closest?.("[data-workout-open]")');
    // the card's row and the recap's button take their own tap straight away (the post waits out a double tap)
    expect(card).toContain("e.stopPropagation();\n          onRecap();");
    expect(card).toContain("const toRecap = () => (recapCtl.current ? recapCtl.current.toEnd() : onOpen(post));");
  });

  it("a picture or film post's workout is one small chip under the set, its PRs first, sliding to the recap (Nov 17 2026, Nov 20 2026)", () => {
    expect(card).toContain("after:absolute after:-inset-x-1 after:-inset-y-2 after:content-['']\"\n                    data-page-workout");
    expect(card).toContain('className="relative inline-flex h-7 max-w-full items-center gap-1.5 rounded-md bg-secondary/70 pl-2 pr-1.5 text-[12px] leading-none text-foreground');
    expect(card).toContain('aria-label={`Workout recap: ${workoutHeadline(s)}${prLabel ? `, ${prLabel}` : ""}`}');
    expect(card).toContain("onClick={toRecap}");
    expect(card).toContain("data-page-prs");
    // gone while the recap itself is on screen
    expect(card).toContain("{visual && s && !onRecap && (");
    // the workout's name lives in the chip; no separate name line, no "View workout" pill
    expect(card).not.toContain("data-page-workout-name");
    expect(card).not.toContain("View workout\n                  <ChevronRight");
  });

  it("the card's numbers show whole: their own widths, a step smaller on a narrow card, a line of their own before anything's cut", () => {
    expect(card).toContain('"@container relative overflow-hidden bg-muted px-5 text-foreground"');
    expect(card).toContain('nums.length === 3 ? "flex flex-wrap justify-between gap-x-3 gap-y-3" : "grid grid-cols-2"');
    expect(card).toContain('big ? "text-[30px] @max-[16rem]:text-[24px]" : "text-[24px] @max-[15rem]:text-[20px]"');
    expect(card).toContain('big ? "text-[54px] @max-[16rem]:text-[44px]" : "text-[42px]"');
  });

  it("the workout page reads as a summary: plain type, one quiet row of numbers, the exercises with their best set (Nov 17 2026)", () => {
    const detail = read("src/components/community/post-detail.tsx");
    // no condensed display face, no tile grid, no caps labels anywhere on the page
    expect(detail).not.toContain("font-display");
    expect(detail).not.toContain("data-workout-tiles");
    expect(detail).not.toContain("uppercase");
    expect(detail).not.toContain("<WorkoutHero");
    expect(detail).toContain('<h2 className="break-words text-[20px] font-semibold leading-tight tracking-[-0.01em]">{workoutHeadline(s)}</h2>');
    expect(detail).toContain("const meta = [workoutSubtitle(s), monthWorkoutLine(s)].filter(Boolean).join(\" · \");");
    expect(detail).toContain('<dl className="mt-4 flex flex-wrap gap-x-4 gap-y-3 min-[375px]:gap-x-6" data-workout-stats>');
    expect(detail).toContain("const stats = summaryStats(s, unit);");
    const recap = read("src/lib/workout-recap.ts");
    for (const label of ['"Time"', '"Working sets"', '"Volume"', '"PRs"']) expect(recap).toContain(label);
    // each exercise: its name, its working sets and record, its best set in the viewer's unit over the other
    expect(detail).toContain("const best = exerciseBestLines(e, unit);");
    expect(detail).toContain("{best.other && <div");
    expect(detail).toContain("data-exercise-pr");
    // a workout with no picture: its summary is what two taps ❤️
    expect(detail).toContain("heroTap={post.media_type ? undefined : onHeroTap}");
    // the exercises, the reactions and the comments are still all there
    expect(detail).toContain("post.exercises.map((e, i) =>");
    expect(detail).toContain("<CommentThread post={post} viewerIsStaff={viewerIsStaff} inline onOpenAuthor={onOpenAuthor} />");
  });

  it("View workout from the feed opens the page on the workout, past the picture; a profile or a link opens at the top", () => {
    const detail = read("src/components/community/post-detail.tsx");
    expect(detail).toContain('if (jumped.current || at !== "workout" || !post.media_type || !el || !box) return;');
    const screen = read("src/components/community/community-screen.tsx");
    expect(screen.match(/onOpen=\{openWorkout\}/g)?.length).toBe(2);
    expect(screen).toContain('setDetailAt({ id: post.id, at: "workout" });');
    expect(screen).toContain("at={detailAt?.id === detailId ? detailAt.at : undefined}");
    // closing the page however it closes forgets where it opened
    expect(screen).toContain("if (!detailId) setDetailAt(null);");
  });
});
