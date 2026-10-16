import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("privacy lives in Edit profile (Instagram's account privacy)", () => {
  const edit = read("src/components/community/profile-edit.tsx");
  const privacy = read("src/components/community/privacy-settings.tsx");
  const profile = read("src/components/community/profile-view.tsx");

  it("athletes get the private account switch there; a coach sees that coach accounts are always public", () => {
    expect(edit).toContain('<Field label="Privacy">');
    expect(edit).toContain("{isCoach ? <CoachPublicRow /> : <PrivateAccountRow />}");
    expect(privacy).toContain("Coach accounts are always public, so everything you post reaches the whole crew.");
    // asks first, like Instagram, and says your coach still sees your posts
    expect(privacy).toContain('"Switch to private account?"');
    expect(privacy).toContain("`Only followers you approve see your posts and stories. ${staff} always can.`");
    // members have no coach: they never see coach wording
    expect(privacy).toContain('const staff = isSelfServe ? "The JF Effect team" : "Your coach";');
  });

  it("automatic posts stay public: workout stories say so, and the server keeps them (and every coach post) on the crew", () => {
    expect(privacy).toContain("Automatic workout stories are always public.");
    expect(privacy).toContain("Everyone in the crew sees them.");
    const sql = read("supabase/migrations/20261130090000_crew_private_accounts_close_friends.sql");
    expect(sql).toContain("NOT coalesce(NEW.auto_shared, false) AND public.community_is_private(NEW.author_user_id)");
    expect(sql).toContain("AND NOT public.community_is_coach(NEW.author_user_id)");
  });

  it("the profile page itself is just the profile: no settings cards between the bio and the posts", () => {
    expect(profile).not.toContain("<PrivateSwitch");
    expect(profile).not.toContain("<PulseSwitch");
    expect(edit).toContain("<ShareWorkoutsRow />");
  });
});
