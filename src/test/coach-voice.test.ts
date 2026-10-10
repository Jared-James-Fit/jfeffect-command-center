import { describe, expect, it } from "vitest";
import { COACH_VOICE_RULES, DEFAULT_VOICE, buildVoicePrompt, casualize, normalizeVoiceProfile } from "@/lib/coach-voice";
import { readFileSync } from "node:fs";

describe("casualize", () => {
  it("strips the AI tells: em dashes, semicolons, that's / let's / it's", () => {
    const out = casualize("Great work this week. It’s a huge win—that’s a clear sign; let's keep going.");
    expect(out).not.toMatch(/[—–;]/);
    expect(out).toContain("thats");
    expect(out).toContain("lets");
    expect(out).toContain("its a huge win");
  });

  it("lowercases ordinary sentence starts but keeps names and stressed words", () => {
    const out = casualize("Since energy took a hit, rest up. Reece pause the FIRST rep. That's RPE 8");
    expect(out.startsWith("since energy")).toBe(true);
    expect(out).toContain("Reece pause the FIRST rep");
    expect(out).toContain("thats RPE 8");
  });

  it("keeps paragraphs and tidies spacing", () => {
    expect(casualize("Good week!\n\n\n\nThis week lets lock in")).toBe("good week!\n\nthis week lets lock in");
  });
});

describe("buildVoicePrompt", () => {
  it("carries his words, hype-only words, sparing emojis and the never list", () => {
    for (const s of ["cooking", "sheeeesh", "No emoji unless something is hype enough", "🔥🔥🔥", "em dashes", "navigating"]) {
      expect(COACH_VOICE_RULES).toContain(s);
    }
  });

  it("guys get guy terms; edgy humour only when switched on", () => {
    const guy = buildVoicePrompt(DEFAULT_VOICE, { sex: "male", edgyOk: false });
    expect(guy).toContain("big man");
    expect(guy).toContain("Never use: 👅💦, zesty");
    const edgy = buildVoicePrompt(DEFAULT_VOICE, { sex: "male", edgyOk: true });
    expect(edgy).toContain("OK with edgy humour");
    expect(edgy).not.toContain("Never use: 👅💦");
  });

  it("girls get girl terms and never the edgy stuff, even if flagged", () => {
    const girl = buildVoicePrompt(DEFAULT_VOICE, { sex: "female", edgyOk: true });
    expect(girl).toContain("gurllll");
    expect(girl).toContain("Never use: 👅💦, zesty");
    expect(girl).not.toContain("big man");
  });

  it("unknown sex: no gendered terms", () => {
    const p = buildVoicePrompt(DEFAULT_VOICE, null);
    expect(p).toContain("no gendered terms");
    expect(p).not.toContain("You can call him");
  });

  it("a nickname is only for that client", () => {
    const p = buildVoicePrompt(DEFAULT_VOICE, { sex: "male", nickname: "brudda" });
    expect(p).toContain('nickname is "brudda"');
    expect(buildVoicePrompt(DEFAULT_VOICE, { sex: "male" })).not.toContain("brudda");
  });

  it("group posts: no nicknames, no edgy humour", () => {
    const p = buildVoicePrompt(DEFAULT_VOICE, { sex: "male", nickname: "brudda", edgyOk: true }, { group: true });
    expect(p).toContain("a post to the whole group");
    expect(p).not.toContain("brudda");
    expect(p).not.toContain("OK with edgy humour");
  });
});

describe("normalizeVoiceProfile", () => {
  it("fills missing keys with defaults but respects a list the coach emptied", () => {
    const p = normalizeVoiceProfile({ hype: [], everyday: ["  cooked ", "cooked", "", "ngl"] });
    expect(p.hype).toEqual([]);
    expect(p.everyday).toEqual(["cooked", "ngl"]);
    expect(p.emojis).toEqual(DEFAULT_VOICE.emojis);
    expect(p.rules).toBe(DEFAULT_VOICE.rules);
  });

  it("survives junk", () => {
    expect(normalizeVoiceProfile(null)).toEqual(DEFAULT_VOICE);
    expect(normalizeVoiceProfile({ everyday: "nope", examples: [1, ""] }).examples).toEqual(["1"]);
  });
});

describe("wiring", () => {
  it("check-in recap and form-review replies use the per-client voice and clean the text", () => {
    const checkins = readFileSync("src/lib/messenger-checkins.functions.ts", "utf8");
    expect(checkins).toContain("voicePromptForClient(sb, clientId)");
    expect(checkins).toContain("suggested_response: casualize(");
    const reviews = readFileSync("src/lib/submission-reviews.functions.ts", "utf8");
    expect(reviews).toContain("voicePromptForClient(sb, row.client_id)");
    expect(reviews).toContain("safe.client_response = casualize(safe.client_response)");
  });

  it("My Voice is reachable from settings tabs, the gear menu and search", () => {
    expect(readFileSync("src/components/settings/settings-tabs.tsx", "utf8")).toContain('"/admin/voice"');
    expect(readFileSync("src/lib/admin-nav.ts", "utf8")).toContain('to: "/admin/voice"');
    expect(readFileSync("src/lib/admin-route-registry.ts", "utf8")).toContain('to: "/admin/voice"');
    expect(readFileSync("src/routeTree.gen.ts", "utf8")).toContain("'/admin/voice'");
  });
});

describe("voice everywhere he writes", () => {
  it("Summer drafts posts / messages as him in his saved voice", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/summer.server.ts", "utf8");
    expect(src).toMatch(/loadCoachVoice\(supabase\)/);
    expect(src).toMatch(/buildVoicePrompt\(coachVoice, null, \{ group: true \}\)/);
  });
  it("My Voice saves on its own and removing a word can be undone", async () => {
    const { readFileSync } = await import("node:fs");
    const page = readFileSync("src/route-pages/_authenticated/admin/voice.tsx", "utf8");
    expect(page).toMatch(/Autosave/);
    expect(page).toMatch(/label: "Undo"/);
    expect(page).not.toMatch(/Save voice/);
  });
  it("his new phrases are in the starting voice", async () => {
    const { DEFAULT_VOICE } = await import("@/lib/coach-voice");
    expect(DEFAULT_VOICE.everyday).toEqual(expect.arrayContaining(["thats wild", "this is wild", "thats crazy", "v proud"]));
    expect(DEFAULT_VOICE.hype).toEqual(expect.arrayContaining(["WILDDD", "craaazy", "insane", "this is nuts", "so freaking hyped"]));
  });
});
