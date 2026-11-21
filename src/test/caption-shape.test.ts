import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SHAPE_MIN_CHARS, captionSentences, shapeCaption } from "@/lib/caption-shape";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const words = (t: string) => t.replace(/\s+/g, " ").trim();

describe("an automated caption handed back as one block reads in short paragraphs (Nov 21 2026)", () => {
  it("puts the opening line on its own and never changes a word", () => {
    const block =
      "Most taper mistakes are overcorrections. Lifters keep all the work because they're scared strength will disappear, or they back off so long that fitness starts leaking too. Keep the heavy lifts familiar, trim the stuff that piles up fatigue, and don't turn a short taper into time off.";
    const shaped = shapeCaption(block);
    expect(shaped.split("\n\n")[0]).toBe("Most taper mistakes are overcorrections.");
    expect(words(shaped)).toBe(words(block));
  });

  it("keeps a sentence that leans on the one before it with it", () => {
    const block =
      "The shake isn't the magic trick. I see lifters obsess over the post workout window, then end the day nowhere near their target. If a dietitian gave you numbers, use those. If not, pick the range and make it boring.";
    const shaped = shapeCaption(block);
    expect(shaped).toContain("use those. If not, pick the range");
    // "It was bad timing." stays with what it answers
    const timing =
      "This shows up fast in meet prep. The lifter who wins training is usually the one who can hit the next exposure with some pop. If a set turns the rest of the day into damage control, it wasn't toughness. It was bad timing.";
    expect(shapeCaption(timing)).toContain("it wasn't toughness. It was bad timing.");
    // an opener the next sentence leans on stays joined
    const leans = "Sleep matters more than supplements for most lifters. That's the boring answer, and it's the one that keeps holding up every time someone checks it against the fancy stuff. Fix the nights first.";
    expect(shapeCaption(leans)).toBe(leans);
  });

  it("leaves alone what's already shaped, short, or under three sentences", () => {
    const shaped = "Your rest day is part of your program.\n\nNot a day you failed to train.";
    expect(shapeCaption(shaped)).toBe(shaped);
    const lines = "61 PRs last week.\nMarc hit 165lbs x 8.\nColten hit 145lbs x 10 on RDL, an all-time PR and one of his 6 PRs that week, and plenty more besides that.";
    expect(shapeCaption(lines)).toBe(lines);
    const short = "A cue is not a personality trait. Try it light. Keep it if it helps.";
    expect(short.length).toBeLessThan(SHAPE_MIN_CHARS);
    expect(shapeCaption(short)).toBe(short);
    const two = `${"Long sentence that goes on for a while about training and recovery and what a lifter should do. ".repeat(2).trim()}`;
    expect(captionSentences(two)).toHaveLength(2);
    expect(shapeCaption(two)).toBe(two);
  });

  it("splits a long rest once, where a new thought starts, never into one-line sentences", () => {
    const block = [
      "Random jumps make RPE way noisier than it needs to be.",
      "I'm not trying to turn training into a spreadsheet ritual, and nobody needs every warm-up planned to the kilo.",
      "I'm trying to make the early stuff tell you whether today is normal, cooked, or worth pushing before the real work starts.",
      "Pick the same jumps every week for your main lifts and write down how the last warm-up moved.",
      "After a month you'll read your own warm-ups better than any chart.",
    ].join(" ");
    const paras = shapeCaption(block).split("\n\n");
    expect(paras).toHaveLength(3);
    expect(paras.every((p) => captionSentences(p).length >= 1)).toBe(true);
    expect(words(paras.join(" "))).toBe(words(block));
  });

  it("is the net under the deck writer, after its own tidying (an Athlete Insight's one quick paragraph is his shape)", () => {
    expect(read("src/lib/post-decks.server.ts")).toContain("caption: shapeCaption(tidyText(deck.caption))");
    expect(read("src/lib/daily-visuals.ts")).not.toContain("shapeCaption");
    expect(read("src/lib/daily-visuals.ts")).toContain("One paragraph is fine for a quick thought typed in one go");
    const prompt = read("src/lib/post-decks.server.ts");
    expect(prompt).toContain("Written for a phone: short paragraphs of one to three sentences");
    expect(prompt).toContain("One idea, said once.");
  });
});
