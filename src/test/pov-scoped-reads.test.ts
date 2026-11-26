import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shouldPersistQueryKey } from "@/lib/query-persister";

const read = (p: string) => readFileSync(p, "utf8");
describe("Authorized client POV read parity", () => {
  const adapter = read("src/lib/pov/pov-crew-read.ts");
  const sql = read("supabase/migrations/20270602090000_pov_crew_scoped_reads.sql");
  const crew = read("src/components/community/community-screen.tsx");
  it("scopes private reads to the current session and target without a staff fallback", () => {
    expect(adapter).toContain('["pov-crew", session, target, client?.id, ...base]');
    expect(adapter).toContain('if (!session || !target) throw');
    expect(adapter).toContain('db.rpc("admin_pov_crew_read"');
    expect(shouldPersistQueryKey(["pov-crew", "test-session", "test-target"])).toBe(false);
    expect(read("src/components/client-pov-banner.tsx")).toContain('qc.removeQueries({ queryKey: ["pov-crew", id] })');
  });
  it("requires current staff permission, matching auth session and active target mapping", () => {
    expect(sql).toContain("s.staff_user_id = v_actor");
    expect(sql).toContain("s.auth_session_id = v_auth_session");
    expect(sql).toContain("s.ended_at IS NULL AND s.expires_at > now() AND s.max_until > now()");
    expect(sql).toContain("public.coached_client_ids()");
    expect(sql).toContain("c.user_id = s.target_user_id");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.admin_pov_crew_read");
    expect(sql).toContain("WHEN 'ranked'");
    expect(sql).not.toMatch(/\bEXECUTE\s+format\(/i);
    expect(sql).toContain("coalesce(v_old_claims, '')");
  });
  it("uses the real Crew header, profile and Following tab for the selected account", () => {
    expect(crew).toContain("useRankedFeed(following && !followsNobody,");
    expect(crew).toContain("<ActivityHeart onOpen=");
    expect(crew).not.toContain("Their Following feed is theirs to see");
    expect(crew).toContain("<ProfileView userId={portalUserId}");
    expect(read("src/components/community/profile-view.tsx")).toContain("const userId = usePortalUserId()");
  });
  it("shares the same target inbox and nav badge read paths without altering read state", () => {
    expect(read("src/lib/crew-activity.queries.ts")).toContain("if (isPov || !items.length) return");
    expect(read("src/hooks/use-client-nav-badges.ts")).toContain('pov.read("nav_data", "")');
    expect(read("src/lib/direct-chats.ts")).toContain('pov.read("direct_threads"');
    expect(read("src/lib/crew-chats.ts")).toContain('pov.read("crew_threads"');
    expect(read("src/lib/chat-prefs.ts")).toContain("Chat preferences are read-only in POV");
    expect(read("src/components/app-shell.tsx")).toContain("if (!isImpersonating) markNavSeen");
  });
});
