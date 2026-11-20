import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { chatSearch, pickRequestMessage } from "@/lib/submission-message";

const req = (id: string, created_at: string) => ({ id, created_at });

describe("which chat message a submitted form sits on", () => {
  // Jarrett's Nutrition Update: asked Oct 25 and again Nov 19 01:50, sent Nov 19 01:55.
  const asks = [req("oct", "2026-10-25T23:11:52Z"), req("nov", "2026-11-19T01:50:48Z")];

  it("the newest request sent at or before it (the card that shows it)", () => {
    expect(pickRequestMessage(asks, "2026-11-19T01:55:05Z")).toBe("nov");
    expect(pickRequestMessage(asks, "2026-11-01T10:00:00Z")).toBe("oct");
    // a clock a few seconds apart still counts as after the request
    expect(pickRequestMessage(asks, "2026-11-19T01:50:30Z")).toBe("nov");
  });

  it("answered before any card in the chat: the first one; none: nothing", () => {
    expect(pickRequestMessage(asks, "2026-10-01T00:00:00Z")).toBe("oct");
    expect(pickRequestMessage([], "2026-10-01T00:00:00Z")).toBeNull();
    expect(pickRequestMessage(asks, null)).toBe("nov");
  });

  it("opens the chat on the message, or the chat alone", () => {
    expect(chatSearch("c1", "m1")).toEqual({ client: "c1", msg: "m1" });
    expect(chatSearch("c1", null)).toEqual({ client: "c1" });
  });

  it("finds a check-in by its submission bubble, as jsonb (never a Postgres array literal)", () => {
    const src = readFileSync("src/lib/submission-message.ts", "utf8");
    expect(src).toContain('contains([{ kind: "checkin_submission", checkin_submission_id: ref.id }])');
    expect(src).toContain("const contains = (v: unknown) => JSON.stringify(v);");
    expect(src).toContain("request_message_id");
  });

  it("?msg= reaches the thread, which loads back to it, centres and highlights it", () => {
    const route = readFileSync("src/routes/_authenticated/admin/messages.tsx", "utf8");
    expect(route).toContain("msg: search.msg");
    const comm = readFileSync("src/routes/_authenticated/admin/communication.tsx", "utf8");
    expect(comm).toContain("initialMessage={msg}");
    const inbox = readFileSync("src/route-pages/_authenticated/admin/messages.tsx", "utf8");
    expect(inbox).toContain("focusMessageId={selected.id === initialClient ? initialMessage ?? null : null}");
    const thread = readFileSync("src/components/message-thread.tsx", "utf8");
    expect(thread).toContain("listMessagesBetween(clientId, stamp.created_at, earliest.created_at");
    expect(thread).toContain('node.scrollIntoView({ block: "center", behavior: "auto" });');
    expect(thread).toContain("setFlashMessageId(rowId);");
  });
});

describe("jsonb containment is sent as JSON text everywhere", () => {
  it("never a JS array (supabase-js turns it into a Postgres array literal, which jsonb refuses: HTTP 400)", () => {
    const hits = execSync(`grep -rnE '\\.contains\\("[a-z_]+", \\[' src --include=*.ts --include=*.tsx || true`, { encoding: "utf8" })
      .split("\n").filter((l) => l && !l.startsWith("src/test/"));
    expect(hits).toEqual([]);
  });
});
