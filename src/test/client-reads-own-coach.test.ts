import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Nov 26 2026: a client's Messages showed "Coach Jared" with initials, and no
// Call / Text, because clients can't read `coaches` and the row came back empty.
describe("a client sees their own coach in Messages", () => {
  const sql = readFileSync("supabase/migrations/20270531090000_client_reads_own_coach.sql", "utf8");
  const page = readFileSync("src/routes/_authenticated/portal/messages.tsx", "utf8");

  it("reads the coach through the database's own lookup, never the coaches table", () => {
    expect(page).toContain('rpc("my_coach", { _client_id: client!.id })');
    expect(page).not.toContain('from("coaches")');
    // the photo, the header and the thread all use what it returns
    expect(page).toContain("avatarUrl: coach?.photo ?? null");
    expect(page).toContain("peerAvatarPath={coach?.photo ?? null}");
    // a failed read is a failure, not "no coach"
    expect(page).toMatch(/if \(error\) throw error;\s*const row/);
    // the name is the lockscreen's own label ("Coach Jared"), never a typed placeholder
    expect(page).toContain("const coachName = coachLabel(coach?.full_name);");
    expect(page).not.toContain('"Coach Jared"');
  });

  it("returns only that client's coach, to that client, their linked login, an admin or their coach", () => {
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("c.user_id = (SELECT auth.uid())");
    expect(sql).toContain("public.linked_client_id()");
    expect(sql).toContain("'admin'");
    expect(sql).toContain("coached_client_ids()");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.my_coach\(uuid\) FROM PUBLIC, anon;/);
  });

  it("gives the phone only when the coach lets them call or text, and the photo every client may open", () => {
    expect(sql).toContain(
      "CASE WHEN c.coach_call_access_enabled OR c.coach_sms_access_enabled THEN co.phone END",
    );
    expect(sql).toContain("COALESCE(public.community_avatar(co.user_id), co.profile_picture_url)");
  });
});
