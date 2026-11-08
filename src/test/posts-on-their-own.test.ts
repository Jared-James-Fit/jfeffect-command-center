import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync("supabase/migrations/20270213090000_posts_on_their_own.sql", "utf8");
const read = (p: string) => readFileSync(p, "utf8");

describe("every automated post goes out on its own (Nov 8 2026: no approval before it posts)", () => {
  it("lessons post on their own, and that's the default", () => {
    expect(sql).toContain("ALTER TABLE public.community_series_settings ALTER COLUMN lesson_mode SET DEFAULT 'auto';");
    expect(sql).toContain("UPDATE public.community_series_settings SET lesson_mode = 'auto'");
  });

  it("an Athlete Insight is never held for review", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.community_daily_visual_held(r public.community_daily_visuals)");
    expect(sql).toMatch(/community_daily_visual_held[\s\S]*?SELECT false\n\$\$;/);
  });

  it("a birthday draft goes out at its time as the coach's account, unless skipped or paused", () => {
    expect(sql).toContain("SET status = 'scheduled', approved_by = v_coach, approved_at = now(), updated_at = now()");
    expect(sql).toContain("WHERE status = 'ready' AND approved_by IS NULL AND post_at <= _now AND post_at > _now - interval '20 hours';");
    expect(sql).toContain("IF v_coach IS NOT NULL AND NOT v_paused THEN");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.community_birthdays_publish_due(timestamptz) FROM PUBLIC, anon, authenticated;");
    // no "still waiting" nudge any more, and the coach's push says it goes out on its own
    expect(read("src/lib/birthday-posts.server.ts")).not.toContain("birthday_post_reminder");
    expect(read("src/lib/push/app-events.server.ts")).toContain("It goes out on its own at 8am on their birthday. Tap to read or edit it.");
    const ui = read("src/components/community/birthday-posts.tsx");
    expect(ui).toContain("It goes out on its own at ${postTimeLine(post)} on their birthday. Edit it or skip it any time before.");
    expect(ui).toContain('run("skip", "Skipped. It won\'t go out")');
    expect(ui).not.toContain("Approve for ");
  });

  it("Crew's Needs you no longer asks to review a birthday post", () => {
    expect(sql).toContain("$n$'birthday_review', 0, -- birthday posts go out on their own (Nov 8 2026)$n$");
    expect(sql).toContain("RAISE EXCEPTION 'posts on their own: community_admin_pulse no longer has the birthday count'");
  });
});

describe("Athlete Insights are made a week ahead, so there's time to edit", () => {
  it("planned two weeks out and made once a day is within a week", async () => {
    const server = await import("@/lib/daily-visuals.server");
    expect(server.AHEAD_DAYS).toBe(7);
    expect(server.PLAN_DAYS).toBe(14);
    const src = read("src/lib/daily-visuals.server.ts");
    expect(src).toContain('await admin.rpc("community_daily_visuals_plan", { _from: null, _days: PLAN_DAYS });');
    const card = read("src/components/community/daily-pictures-card.tsx");
    expect(card).toContain('"Ready · goes out on its own at 7 · edit any time"');
    expect(card).toContain('"Made a week before"');
  });
});
