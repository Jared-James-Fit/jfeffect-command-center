import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { captionBreaks } from "@/lib/community";
import { NOTE_CUT_LINES, NOTE_SHOW_ALL_LINES } from "@/components/community/note-caption";

const read = (f: string) => readFileSync(f, "utf8");
const cutAt = (text: string) => captionBreaks(text).map((i) => text.slice(0, i));

describe("coach posts in the feed: whole, or cut on a full thought with … more", () => {
  it("cuts only at the end of a line, a sentence or an emoji, never mid-sentence", () => {
    const wins =
      "yall are cooking. 41 PRs last week\n\nReecey hit 265lbs x 8 on hack squat. 17 PRs in 1 week crazy\nVicky went 385lbs x 5 on comp deadlift for an all time PR\n\nshoutout to Colten, Ashley and Marc for showing up\n\n12 of you got after it last week. proud of this crew 🔥";
    expect(cutAt(wins)).toEqual([
      "yall are cooking.",
      "yall are cooking. 41 PRs last week",
      "yall are cooking. 41 PRs last week\n",
      "yall are cooking. 41 PRs last week\n\nReecey hit 265lbs x 8 on hack squat.",
      "yall are cooking. 41 PRs last week\n\nReecey hit 265lbs x 8 on hack squat. 17 PRs in 1 week crazy",
      "yall are cooking. 41 PRs last week\n\nReecey hit 265lbs x 8 on hack squat. 17 PRs in 1 week crazy\nVicky went 385lbs x 5 on comp deadlift for an all time PR",
      "yall are cooking. 41 PRs last week\n\nReecey hit 265lbs x 8 on hack squat. 17 PRs in 1 week crazy\nVicky went 385lbs x 5 on comp deadlift for an all time PR\n",
      "yall are cooking. 41 PRs last week\n\nReecey hit 265lbs x 8 on hack squat. 17 PRs in 1 week crazy\nVicky went 385lbs x 5 on comp deadlift for an all time PR\n\nshoutout to Colten, Ashley and Marc for showing up",
      "yall are cooking. 41 PRs last week\n\nReecey hit 265lbs x 8 on hack squat. 17 PRs in 1 week crazy\nVicky went 385lbs x 5 on comp deadlift for an all time PR\n\nshoutout to Colten, Ashley and Marc for showing up\n",
      "yall are cooking. 41 PRs last week\n\nReecey hit 265lbs x 8 on hack squat. 17 PRs in 1 week crazy\nVicky went 385lbs x 5 on comp deadlift for an all time PR\n\nshoutout to Colten, Ashley and Marc for showing up\n\n12 of you got after it last week.",
    ]);
    // after an emoji (a sentence of its own in the coach's posts), never before the end
    expect(cutAt("happy halloween 🎃 yes you can have the candy lol")).toEqual([
      "happy halloween 🎃",
    ]);
    expect(cutAt("one line only 💪")).toEqual([]);
    // decimals and commas aren't stops
    expect(cutAt("hit 102.5kg x 3, then 105 next week")).toEqual([]);
  });

  it("every daily, holiday and birthday post fits whole; only long ones get … more", () => {
    // measured at 15px on 296-330px wide cards: the longest library posts run 8-12 lines,
    // a Wednesday Wins with a full shout-out list ~16
    expect(NOTE_SHOW_ALL_LINES).toBe(12);
    expect(NOTE_CUT_LINES).toBe(9);
    const cap = read("src/components/community/note-caption.tsx");
    expect(cap).toContain('text.slice(0, breaks[mid]).trimEnd() + "… more"');
    expect(cap).toContain("e.stopPropagation();\n        setOpen(true);");
    expect(read("src/components/community/post-card.tsx")).toContain(
      "<NoteCaption text={post.caption} mentions={post.mentions} onOpenPerson={onOpenPerson} clamp={clamp} />",
    );
  });
});
