import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUPPORT_KB, SUPPORT_KB_VERSION, kbLinks } from "@/content/support-kb";
import {
  CLEO_SUPPORT_LABEL, MAX_CLEO_TURNS, articlesFor, cleanAnswer, cleoStreak, escalationTrigger, handoffMessage, isRepeat,
  kbForPrompt, modelEscalation, parseCleoReply, ruleEscalation, searchKb, supportSegments,
} from "@/lib/support-cleo/rules";
import { DEFAULT_ROUTES } from "@/lib/ai/routing";

const read = (f: string) => readFileSync(f, "utf8");

describe("the support knowledge base is the real app", () => {
  it("is versioned, and every link is a screen that exists", () => {
    expect(SUPPORT_KB_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    const tree = read("src/routeTree.gen.ts");
    for (const to of kbLinks()) {
      const path = to.split("#")[0];
      const found = tree.includes(`fullPath: '${path}'`) || tree.includes(`fullPath: '${path}/'`);
      expect(found, to).toBe(true);
    }
  });

  it("every article says something, has a link, and ids are unique", () => {
    expect(new Set(SUPPORT_KB.map((a) => a.id)).size).toBe(SUPPORT_KB.length);
    for (const a of SUPPORT_KB) {
      expect(a.answer.length, a.id).toBeGreaterThan(20);
      expect(a.links.length, a.id).toBeGreaterThan(0);
      // no prices or promises in the help answers
      expect(a.answer, a.id).not.toMatch(/\$\d|guarantee|free trial|refund (is|will)/i);
    }
  });

  it("a member is only told about what members have, a client about what clients have", () => {
    const member = articlesFor("self_serve").map((a) => a.id);
    const client = articlesFor("coaching").map((a) => a.id);
    expect(member).not.toContain("coach-chat");
    expect(member).not.toContain("goals-setup");
    expect(client).toContain("coach-chat");
    expect(client).not.toContain("start-program");
    expect(kbForPrompt("self_serve")).not.toContain("Goals & Setup");
  });

  it("search finds the right answer for plain questions", () => {
    expect(searchKb("how do I change to kilograms", "self_serve")[0].id).toBe("units");
    expect(searchKb("where do I log my workout", "self_serve")[0].id).toBe("log-workout");
    expect(searchKb("turn off notifications", "coaching")[0].id).toBe("notifications");
  });
});

describe("Cleo hands off what isn't Cleo's", () => {
  it("money, accounts, coaching, complaints and asking for a person never get an AI answer", () => {
    expect(escalationTrigger("Can I talk to a real person?")).toBe("human_request");
    expect(escalationTrigger("speak with Jared please")).toBe("human_request");
    expect(escalationTrigger("I was charged twice, I want a refund")).toBe("billing");
    expect(escalationTrigger("cancel my subscription")).toBe("billing");
    expect(escalationTrigger("I think my account was hacked")).toBe("account_security");
    expect(escalationTrigger("I can't log in on my new phone")).toBe("account_security");
    expect(escalationTrigger("my knee hurts when I squat, should I train?")).toBe("coaching");
    expect(escalationTrigger("This is ridiculous, nothing works")).toBe("complaint");
    expect(escalationTrigger("how do I change to kilograms")).toBeNull();
    expect(escalationTrigger("where are my PRs")).toBeNull();
  });

  it("the same ask three times, or too many answers in a row, is a hand-off (no endless loop)", () => {
    expect(isRepeat("my workout won't save the sets", ["workout won't save sets", "the sets in my workout won't save"])).toBe(true);
    expect(isRepeat("my workout won't save", ["how do I change units"])).toBe(false);
    const msgs = (roles: string[]) => roles.map((r) => ({ sender_role: r }));
    expect(cleoStreak(msgs(["member", "cleo", "member", "cleo"]))).toBe(2);
    expect(cleoStreak(msgs(["cleo", "team", "member", "cleo"]))).toBe(1);
    expect(MAX_CLEO_TURNS).toBeGreaterThanOrEqual(3);
  });

  it("an answer is shown only when it parses, is short and links only to the help answers' screens", () => {
    expect(parseCleoReply("nonsense")).toBeNull();
    const r = parseCleoReply('Sure: {"answer":"Go to /portal/account#units.","escalate":false,"confident":true,"category":"unsure","summary":"","tried":"","next_action":""}');
    expect(r?.answer).toBe("Go to /portal/account#units.");
    expect(cleanAnswer(r!.answer)).toBe("Go to /portal/account#units.");
    expect(cleanAnswer("Open https://example.com to fix it")).toBeNull();
    expect(cleanAnswer("Open /portal/secret-page")).toBeNull();
    expect(cleanAnswer("x".repeat(700))).toBeNull();
    expect(cleanAnswer("**Units** are in Account")).toBe("Units are in Account");
    expect(parseCleoReply('{"answer":"","escalate":true,"category":"made_up"}')?.category).toBe("unsure");
  });

  it("the hand-off says so once, plainly, and the card carries what the team needs", () => {
    expect(handoffMessage("billing", "Sam")).toMatch(/^Thanks, Sam\. Billing and refunds are handled by the JF Effect team/);
    expect(handoffMessage("unsure")).toContain("usually within a day");
    const card = ruleEscalation({ category: "billing", by: "cleo", lastAsk: "refund please", cleoSaid: ["a", "b", "c", "d"], at: "t" });
    expect(card).toMatchObject({ category: "billing", priority: "high", summary: 'They wrote: "refund please"', reason: "Billing or refund" });
    expect(card.tried).toEqual(["b", "c", "d"]);
    expect(card.next_action).toMatch(/Cleo said nothing about charges/);
    const m = modelEscalation({ answer: "", escalate: true, confident: false, category: "bug", summary: "Sets vanish after saving", tried: "", next_action: "" }, card);
    expect(m).toMatchObject({ category: "bug", summary: "Sets vanish after saving", priority: "normal" });
  });

  it("in-app paths in Cleo's messages become taps, anything else stays text", () => {
    expect(supportSegments("Open /portal/account#units. Then /portal/nope")).toEqual([
      { text: "Open " }, { to: "/portal/account#units", label: "Units & training days" }, { text: ". Then /portal/nope" },
    ]);
    expect(supportSegments("See /challenges")).toEqual([{ text: "See " }, { to: "/challenges", label: "Challenges" }]);
  });
});

describe("Cleo support wiring", () => {
  it("runs on the OpenAI key, labelled as Cleo, never as the team", () => {
    expect(DEFAULT_ROUTES.support_answer.models.every((m) => m.startsWith("openai:"))).toBe(true);
    expect(CLEO_SUPPORT_LABEL).toBe("Cleo · JF Effect's assistant");
    const server = read("src/lib/support-cleo/cleo-support.server.ts");
    expect(server).toContain('askRoute("support_answer"');
    expect(server).toContain("openaiOnly: true");
    expect(server).toContain('sender_role: "cleo"');
    // Cleo writes only into a thread it still has
    expect(server).toContain('.eq("handler", "cleo")');
    const sql = read("supabase/migrations/20270527106100_support_cleo_first_line.sql");
    expect(sql).toContain("CHECK (sender_role IN ('member', 'team', 'cleo'))");
    expect(sql).toContain("WHEN status <> 'closed' AND handler = 'human' THEN unread_for_team + 1");
  });

  it("Talk to a person is always on the Support chat, and a team reply takes the chat from Cleo", () => {
    const ui = read("src/components/support/support-conversation.tsx");
    expect(ui).toContain("Talk to a person");
    expect(ui).toContain("data-support-help-hub");
    const fns = read("src/lib/member-support.functions.ts");
    expect(fns).toContain('update({ handler: "human", owner_user_id: thread.owner_user_id ?? context.userId })');
    expect(fns).toContain("export const askForPerson");
    // drafts in his voice are only drafts
    expect(fns).toContain("export const draftSupportReply");
    expect(fns.slice(fns.indexOf("export const draftSupportReply"))).not.toContain("member_support_messages\").insert");
  });
});
