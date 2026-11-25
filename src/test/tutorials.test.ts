import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TUTORIALS, tutorialDoneKey, tutorialKey, tutorialStatus, tutorialToShow, tutorialsFor } from "@/lib/tutorials/registry";

const read = (f: string) => readFileSync(f, "utf8");

describe("tutorials", () => {
  it("each one is short and only for what the person has", () => {
    expect(new Set(TUTORIALS.map((t) => t.id)).size).toBe(TUTORIALS.length);
    for (const t of TUTORIALS) for (const tier of ["self_serve", "coaching"] as const) {
      expect(t.steps(tier).length, t.id).toBeLessThanOrEqual(3);
      for (const s of t.steps(tier)) expect(s.body.length, t.id).toBeLessThan(200);
    }
    expect(tutorialsFor("coaching").map((t) => t.id)).not.toContain("programs");
    expect(tutorialsFor("self_serve").map((t) => t.id)).toContain("programs");
    // a member's Messages tutorial never mentions a coach chat they don't have
    const member = TUTORIALS.find((t) => t.id === "messages")!.steps("self_serve");
    expect(member.map((s) => s.title)).not.toContain("Your coach is first");
  });

  it("opens once on its screen's first visit, and never again once finished or skipped", () => {
    const none = new Set<string>();
    expect(tutorialToShow("/portal/messages", "self_serve", none)?.id).toBe("messages");
    expect(tutorialToShow("/portal/programs/new", "self_serve", none)?.id).toBe("programs");
    expect(tutorialToShow("/portal/programs", "coaching", none)).toBeNull();
    expect(tutorialToShow("/portal/messages-old", "self_serve", none)).toBeNull();
    expect(tutorialToShow("/portal/messages", "self_serve", new Set([tutorialKey("messages")]))).toBeNull();
    // the logger's own tutorial is opened by the workout itself, never by the gate
    expect(tutorialToShow("/portal/workouts/abc", "self_serve", none)).toBeNull();
    expect(tutorialStatus("crew", new Set([tutorialKey("crew")]))).toBe("skipped");
    expect(tutorialStatus("crew", new Set([tutorialKey("crew"), tutorialDoneKey("crew")]))).toBe("done");
    expect(tutorialStatus("crew", none)).toBe("new");
  });

  it("is stored server-side, never in View as client, and the hub replays any of them", () => {
    const ui = read("src/components/tutorials/tutorials.tsx");
    expect(ui).toContain('.from("feature_announcement_views")');
    expect(ui).toContain("if (isImpersonating || loading || !tier || !seen || open) return;");
    expect(ui).toContain('document.querySelector(\'[role="dialog"], [role="alertdialog"]\')');
    expect(ui).toContain("<QuickLogTips");
    expect(read("src/routes/_authenticated/portal/account.tsx")).toContain('<SettingsSection id="help" icon={LifeBuoy} title="Help & Tutorials">');
    expect(read("src/routes/_authenticated/portal/route.tsx")).toContain("<TutorialGate />");
    expect(read("src/components/support/support-conversation.tsx")).toContain('hash="help"');
  });
});
