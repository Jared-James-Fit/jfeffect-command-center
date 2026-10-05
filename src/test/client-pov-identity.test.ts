import { describe, expect, it } from "vitest";
import { isPovRequest, resolvePovClientId, resolvePovUserId } from "@/lib/client-pov.server";

function fakeSupabase(opts: { viewer?: string; admin?: boolean; coachOf?: string[]; clientsByUser?: Record<string, string> }) {
  return {
    rpc: async (name: string, args: any) => {
      if (name === "portal_viewer_uid") return { data: opts.viewer ?? null, error: null };
      if (name === "has_role") return { data: !!opts.admin, error: null };
      if (name === "is_assigned_coach") return { data: (opts.coachOf ?? []).includes(args._client_id), error: null };
      return { data: null, error: null };
    },
    from: () => {
      let uid = "";
      const q: any = {
        select: () => q,
        eq: (_c: string, v: string) => { uid = v; return q; },
        maybeSingle: async () => ({ data: opts.clientsByUser?.[uid] ? { id: opts.clientsByUser[uid] } : null }),
      };
      return q;
    },
  };
}

describe("client POV identity", () => {
  it("uses the session user when not viewing as anyone", async () => {
    const sb = fakeSupabase({ clientsByUser: { me: "c-me" } });
    expect(await resolvePovUserId(sb, "me", {})).toBe("me");
    expect(await resolvePovClientId(sb, "me", {})).toBe("c-me");
    expect(isPovRequest("me", {})).toBe(false);
  });

  it("lets an authorised coach/admin view as the client", async () => {
    const sb = fakeSupabase({ viewer: "colten", clientsByUser: { colten: "c-colten" } });
    expect(await resolvePovUserId(sb, "coach", { viewAsUserId: "colten" })).toBe("colten");
    expect(await resolvePovClientId(sb, "coach", { viewAsUserId: "colten" })).toBe("c-colten");
    const sb2 = fakeSupabase({ coachOf: ["c-colten"] });
    expect(await resolvePovClientId(sb2, "coach", { viewAsClientId: "c-colten" })).toBe("c-colten");
  });

  it("refuses anyone else", async () => {
    const sb = fakeSupabase({ viewer: "client-a" });
    await expect(resolvePovUserId(sb, "client-a", { viewAsUserId: "client-b" })).rejects.toThrow("Forbidden");
    await expect(resolvePovClientId(fakeSupabase({}), "client-a", { viewAsClientId: "c-b" })).rejects.toThrow("Forbidden");
  });
});
