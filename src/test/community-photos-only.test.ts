import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const read = (f: string) => readFileSync(f, "utf8");
const sql = read("supabase/migrations/20270108090000_community_photos_only.sql");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsxFiles(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [],
  );
}

describe("Crew screens show the community photo, never the account (verification) photo", () => {
  it("one rule: the Crew photo, else a coach's team photo, else initials", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.community_avatar(_user_id uuid)");
    expect(sql).toContain("SELECT cp.avatar_path FROM public.community_profiles cp JOIN me ON cp.user_id = me.uid");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.community_avatar(uuid) FROM PUBLIC, anon, authenticated;");
    // the account photo is never a source
    const helper = sql.slice(sql.indexOf("FUNCTION public.community_avatar"), sql.indexOf("FUNCTION public.community_author"));
    expect(helper).not.toContain("profiles p");
    expect(helper).not.toContain("avatar_url");
    expect(helper).not.toContain("clients");
    // Crew posts' author card goes through the same rule
    expect(sql).toContain("'avatar_url', public.community_avatar(me.uid),");
  });

  it("rankings, the Hall of Strength, careers and level cards all switch over", () => {
    for (const fn of [
      "get_athlete_public_profile",
      "get_athlete_rankings",
      "get_powerlifting_career",
      "get_strength_board",
      "get_strength_board_all",
      "get_strength_board_meets",
      "get_strength_board_roster",
      "league_month_scores",
    ]) {
      expect(sql).toContain(`'${fn}'`);
    }
    expect(sql).toContain("'public.community_avatar(\\1.id) AS avatar_url'");
    expect(sql).toContain("RAISE EXCEPTION '% still reads a profile photo', fn;");
  });

  it("coach-run group chats too", () => {
    const group = sql.slice(sql.indexOf("FUNCTION public.get_group_member_profiles"));
    expect(group).toContain("public.community_avatar(gm.user_id) AS avatar_url");
    expect(group).not.toContain("p.avatar_url");
    expect(group).not.toContain("profile_picture_url");
  });

  it("a stored photo path is signed before it's drawn (a raw path never loads)", () => {
    for (const f of tsxFiles("src")) {
      expect(read(f), f).not.toMatch(/<AvatarImage src=\{[^}]*avatar_url/);
    }
    for (const f of [
      "src/components/portal/strength-board.tsx",
      "src/components/portal/powerlifting-career.tsx",
      "src/components/portal/athlete-level-card.tsx",
    ]) {
      expect(read(f)).toContain('import { AvatarPhoto } from "@/components/user-avatar";');
    }
    const avatar = read("src/components/user-avatar.tsx");
    expect(avatar).toContain("export function AvatarPhoto(");
    expect(avatar).toContain("export function useAvatarSrc(");
  });
});
