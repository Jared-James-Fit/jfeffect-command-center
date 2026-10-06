import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let sessionUserId: string | null = null;

vi.mock("@/integrations/supabase/client", () => {
  const chain: any = new Proxy(() => chain, {
    get: (_t, prop) => {
      if (prop === "then") return undefined; // not thenable until awaited at the end
      return (...args: unknown[]) => { calls.push(String(prop)); return chain; };
    },
  });
  return {
    supabase: {
      from: (t: string) => { calls.push(`from:${t}`); return chain; },
      rpc: (n: string) => { calls.push(`rpc:${n}`); return Promise.resolve({ data: null, error: null }); },
      auth: { getSession: async () => ({ data: { session: sessionUserId ? { user: { id: sessionUserId } } : null } }) },
    },
  };
});

const store = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const POV = { id: "client-1", user_id: "client-user-1", full_name: "Jennifer" };

beforeEach(() => {
  calls.length = 0;
  store.clear();
  sessionUserId = null;
  (globalThis as any).window = { sessionStorage: fakeStorage, localStorage: fakeStorage };
});
afterEach(() => { delete (globalThis as any).window; });

describe("isViewingAsClient", () => {
  it("is false when no POV is active", async () => {
    const { isViewingAsClient } = await import("@/lib/pov-guard");
    sessionUserId = "coach-1";
    expect(await isViewingAsClient("client-1")).toBe(false);
  });

  it("is true for the POV client when a different user (the coach) is signed in", async () => {
    const { isViewingAsClient, POV_STORAGE_KEY } = await import("@/lib/pov-guard");
    store.set(POV_STORAGE_KEY, JSON.stringify(POV));
    sessionUserId = "coach-1";
    expect(await isViewingAsClient("client-1")).toBe(true);
    expect(await isViewingAsClient()).toBe(true);
    expect(await isViewingAsClient("some-other-client")).toBe(false);
  });

  it("never suppresses a real client signed in on a device where POV was left on", async () => {
    const { isViewingAsClient, POV_STORAGE_KEY } = await import("@/lib/pov-guard");
    store.set(POV_STORAGE_KEY, JSON.stringify(POV));
    sessionUserId = "client-user-1"; // the client themself
    expect(await isViewingAsClient("client-1")).toBe(false);
  });

  it("is false when nobody is signed in", async () => {
    const { isViewingAsClient, POV_STORAGE_KEY } = await import("@/lib/pov-guard");
    store.set(POV_STORAGE_KEY, JSON.stringify(POV));
    expect(await isViewingAsClient("client-1")).toBe(false);
  });

  it("uses the same storage key as the POV provider", () => {
    const provider = readFileSync("src/lib/client-impersonation.tsx", "utf8");
    expect(provider).toContain('const STORAGE_KEY = "jfeffect.clientPov"');
  });
});

describe("POV leaves no 'seen' marks", () => {
  it("markRead(client) writes nothing while a coach views as that client", async () => {
    const { POV_STORAGE_KEY } = await import("@/lib/pov-guard");
    const { markRead } = await import("@/lib/messages");
    store.set(POV_STORAGE_KEY, JSON.stringify(POV));
    sessionUserId = "coach-1";
    await markRead("client-1", "client");
    expect(calls).toEqual([]);
  });

  it("markRead(client) still works for the real client", async () => {
    const { POV_STORAGE_KEY } = await import("@/lib/pov-guard");
    const { markRead } = await import("@/lib/messages");
    store.set(POV_STORAGE_KEY, JSON.stringify(POV));
    sessionUserId = "client-user-1";
    await markRead("client-1", "client").catch(() => {});
    expect(calls.some((c) => c === "from:conversation_state")).toBe(true);
    expect(calls.some((c) => c === "from:messages")).toBe(true);
  });

  it("the coach's own read marking is unaffected by POV state", async () => {
    const { POV_STORAGE_KEY } = await import("@/lib/pov-guard");
    const { markRead } = await import("@/lib/messages");
    store.set(POV_STORAGE_KEY, JSON.stringify(POV));
    sessionUserId = "coach-1";
    await markRead("client-1", "admin").catch(() => {});
    expect(calls).toContain("rpc:staff_mark_conversation_read");
  });

  it("group read, lift-viewed and check-in review reads are guarded at the source", () => {
    const guarded: Array<[string, string]> = [
      ["src/lib/group-chats.ts", "export async function markGroupRead"],
      ["src/lib/lift-videos.ts", "export async function markClientViewed"],
      ["src/lib/manual-check-in-reviews.ts", "export async function markReviewSeen"],
      ["src/lib/manual-check-in-reviews.ts", "export async function markReviewRead"],
      ["src/lib/manual-check-in-reviews.ts", "export async function markThreadRead"],
    ];
    for (const [file, sig] of guarded) {
      const src = readFileSync(file, "utf8");
      const body = src.slice(src.indexOf(sig), src.indexOf(sig) + 400);
      expect(body, `${file} ${sig}`).toContain("isViewingAsClient(");
    }
  });

  it("the chat itself also stays off while viewing as a client (no online dot, typing or auto check-ins)", () => {
    const thread = readFileSync("src/components/message-thread.tsx", "utf8");
    expect(thread).toContain("const povClient = role === \"client\" && viewingAsClient;");
    expect(thread).toContain("|| povClient) return;");
    expect(thread).toContain("if (povClient) return;");
    const portal = readFileSync("src/routes/_authenticated/portal/messages.tsx", "utf8");
    expect(portal).toContain('useChatPresence(viewingAsClient ? null : client?.id ?? null, "client")');
    const group = readFileSync("src/components/group-message-thread.tsx", "utf8");
    expect(group).toContain("useGroupPresence(viewingAsClient ? null : groupId");
  });
});
