import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { captionTags, tagHandle, tagSummary, uniqueTags, withTags } from "@/lib/crew-tags";
import { buildFilterRow, isFxKey, NORMAL_KEY } from "@/components/community/crew-filters";
import type { FilterContext } from "@/lib/story-filters";

const read = (p: string) => readFileSync(p, "utf8");
const marc = { user_id: "m", name: "Marc Asugui", username: "marc" };
const dwayne = { user_id: "d", name: "Dwayne", username: "dwayne.lifts" };
const noHandle = { user_id: "v", name: "Vicky", username: null };

describe("tagging people: the @ the database already reads", () => {
  it("a tag is their @username (else their name)", () => {
    expect(tagHandle(marc)).toBe("marc");
    expect(tagHandle(noHandle)).toBe("Vicky");
  });
  it("adds only the handles nobody typed, on a line of their own; the caption stays theirs", () => {
    expect(withTags("", [marc])).toBe("@marc");
    expect(withTags("heavy day", [marc, dwayne])).toBe("heavy day\n\n@marc @dwayne.lifts");
    // already in it (any case): not doubled
    expect(withTags("lifting with @Marc today", [marc])).toBe("lifting with @Marc today");
    // "@marc" isn't the start of "@marcus"
    expect(captionTags("hi @marcus", marc)).toBe(false);
    expect(captionTags("hi @dwayne.lifts.", dwayne)).toBe(true);
    expect(withTags("x", [marc, marc])).toBe("x\n\n@marc");
  });
  it("says who in a few words", () => {
    expect(tagSummary([])).toBe("");
    expect(tagSummary([marc])).toBe("Marc");
    expect(tagSummary([marc, dwayne])).toBe("Marc and Dwayne");
    expect(tagSummary([marc, dwayne, noHandle, { user_id: "z", name: "Zed" }])).toBe("Marc, Dwayne and 2 others");
    expect(uniqueTags([marc, dwayne, marc]).map((p) => p.user_id)).toEqual(["m", "d"]);
  });
});

describe("one filter row for the story camera and the New post screen", () => {
  const ctx: FilterContext = { now: new Date(2026, 10, 22, 7, 0), firstName: "Marc", session: { title: "Block 2 · Week 3", started: false }, finished: null, block: { block: 2, week: 3 }, fuel: "pre" };
  it("Normal first, then the groups in the order that fits; a group's cards lead it", () => {
    const row = buildFilterRow(ctx, { lockin: [{ key: "lockin:lockin", look: "lockin", label: "Locked in" }] });
    expect(row.items[0].key).toBe(NORMAL_KEY);
    // a session to start: Lock in first, its own card first in it
    expect(row.groups[0].key).toBe("lockin");
    expect(row.items[1].key).toBe("lockin:lockin");
    expect(row.items.filter((i) => isFxKey(i.key)).length).toBeGreaterThan(30);
    // every item but Normal sits in a group with a chip
    const chips = new Set(row.groups.map((g) => g.key));
    expect(row.items.slice(1).every((i) => i.group && chips.has(i.group))).toBe(true);
    // a filter appears once
    expect(new Set(row.items.map((i) => i.key)).size).toBe(row.items.length);
  });
  it("grades only, where a design can't go", () => {
    const row = buildFilterRow(ctx, {}, { gradesOnly: true });
    expect(row.items.slice(1).every((i) => i.group === "vibe")).toBe(true);
  });
});

describe("New post, Instagram's way (Nov 22 2026)", () => {
  const composer = read("src/components/community/post-composer.tsx");
  const picker = read("src/components/community/share-workout-picker.tsx");
  const studio = read("src/components/community/share-studio.tsx");
  it("the + opens the photo library in the same tap (an input always in the page), then the three steps", () => {
    const pick = read("src/components/community/composer-pick.tsx");
    expect(pick).toContain('accept="image/*,video/*" multiple hidden');
    expect(picker).toContain("{picker.inputs}");
    expect(composer).toContain('const STEPS: Step[] = ["select", "edit", "details"];');
    // the step on screen has no transform, so the text editor's fixed overlay covers the screen, not a pane
    expect(composer).toContain('transform: i === at ? "none" : `translate3d(${(i - at) * 100}%,0,0)`,');
  });
  it("what's posted is what the edit step shows: a filter or stickers re-draw the first photo, the rest go as framed", () => {
    expect(composer).toContain("const needsRender = !!coverImage && (useCard || items.length > 0);");
    expect(composer).toContain("const extras = words ? [] : await tray.ready(shape, coverId);");
    // the plain copy of a re-drawn first photo is taken off once the post is up
    expect(composer).toContain("if (coverId) tray.remove(coverId);");
    // a design (a card, a filter's words) is drawn at 9:16 (the full-screen card) or 4:5
    expect(composer).toContain('if (design && aspect !== "portrait" && aspect !== "full") setAspect("full");');
    expect(composer).toContain('const size = aspect === "full" ? "full" : aspect === "portrait" ? "feed"');
  });
  it("which post a filter makes: lock in starts the session, a workout card or the Workout row posts the workout, else plain", () => {
    expect(picker).toContain('activeMode === "lockin" ? lockPost : workoutLinked && target ? workout.post : activeMode === "meal" ? mealPost : plainPost;');
    expect(picker).toContain("locked: activeMode === \"workout\",");
  });
  it("a story tags people: an @ sticker on a photo, the tag on the story's caption, tappable in the viewer", () => {
    expect(studio).toContain("mentionStickerItem(a.user_id, tagHandle(a)");
    expect(read("src/components/community/crew-stories.tsx")).toContain("<MentionText text={caption} mentions={post.mentions} onOpen={onOpenPerson} />");
  });
  it("a photo taken or picked is filtered with the camera's own row (chips, ring, name), in the story editor and on New post alike", () => {
    const carousel = read("src/components/community/look-carousel.tsx");
    // without a shutter it's a picker: the ring shows what's on and is never a photo button
    expect(carousel).toContain("if (!many) return onShoot ? <Shutter");
    expect(carousel).toContain("if (pick) return;");
    // the story editor: the whole row over the picture's foot, stepping aside for a peek, framing or a sticker on its way to the bin
    expect(studio).toContain("? { looks: filters, look: filter ?? null, onLook: onFilter, groups: filterGroups }");
    expect(studio).toContain("<LookCarousel looks={editRing.looks} groups={editRing.groups} look={editRing.look} onLook={editRing.onLook} />");
    expect(studio).toContain("peek || framingLive || stickerDrag ?");
    expect(studio).toContain("onDragging={setStickerDrag}");
    // New post's Edit step: the same row, not a strip of its own
    expect(composer).toContain("<LookCarousel looks={filters.items} groups={filters.groups} look={filters.on} onLook={filters.pick} />");
    expect(composer).not.toContain("function FilterStrip");
  });
  it("leaving with something picked asks first; Share shows its upload in the button", () => {
    expect(composer).toContain("Discard post?");
    expect(composer).toContain('{uploading ? `Uploading… ${progress}%` : "Sharing…"}');
  });
});
