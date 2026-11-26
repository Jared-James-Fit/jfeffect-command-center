import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { moderationDue, moderationKindLabel, withoutBlocked, withoutComment, withoutPosts } from "@/lib/crew-moderation";

const read = (p: string) => readFileSync(p, "utf8");
const sql = read("supabase/migrations/20270527109000_crew_ugc_safety.sql");

describe("the moderation queue's clock and labels", () => {
  const now = Date.parse("2026-11-25T12:00:00Z");
  it("counts down the 24 hours, then says how late", () => {
    expect(moderationDue("2026-11-26T06:30:00Z", now)).toEqual({ label: "18 h left", late: false });
    expect(moderationDue("2026-11-25T12:40:00Z", now)).toEqual({ label: "Under 1 h left", late: false });
    expect(moderationDue("2026-11-25T11:50:00Z", now)).toEqual({ label: "Just overdue", late: true });
    expect(moderationDue("2026-11-25T09:00:00Z", now)).toEqual({ label: "3 h overdue", late: true });
    expect(moderationDue(null, now)).toBeNull();
    expect(moderationDue("not a date", now)).toBeNull();
  });
  it("names what each item is (a story is a post to the server)", () => {
    expect(moderationKindLabel("post", { story: true })).toBe("Story");
    expect(moderationKindLabel("post", null)).toBe("Post");
    expect(moderationKindLabel("message")).toBe("Message request");
    expect(moderationKindLabel("profile")).toBe("Account");
  });
});

describe("what you report or block leaves your screen", () => {
  it("drops a reported post from every feed page", () => {
    const data = { pages: [{ posts: [{ id: "a" }, { id: "b" }], has_more: true }, { posts: [{ id: "c" }], has_more: false }], pageParams: [null, 1] };
    const out = withoutPosts(data, new Set(["b", "c"]));
    expect(out!.pages.map((p) => p.posts.map((x) => x.id))).toEqual([["a"], []]);
    expect(out!.pages[0].has_more).toBe(true);
    expect(withoutPosts(data, new Set())).toBe(data);
    expect(withoutPosts(undefined, new Set(["a"]))).toBeUndefined();
  });
  it("drops a reported comment and the replies under it", () => {
    const list = [{ id: "1" }, { id: "2", parent_id: "1" }, { id: "3" }];
    expect(withoutComment(list, "1")!.map((c) => c.id)).toEqual(["3"]);
  });
  it("leaves blocked people off Rankings, keeping everyone else's rank", () => {
    const rows = [{ client_id: "x", rank: 1 }, { client_id: "y", rank: 2 }, { client_id: null, rank: 3 }];
    expect(withoutBlocked(rows, ["x"])).toEqual([{ client_id: "y", rank: 2 }, { client_id: null, rank: 3 }]);
    expect(withoutBlocked(rows, [])).toBe(rows);
    expect(withoutBlocked(rows, undefined)).toBe(rows);
    // the Hall's roster names people by key
    expect(withoutBlocked([{ key: "c:x" }, { key: "c:y" }, { key: "a:z" }], ["x"]).map((r) => r.key)).toEqual(["c:y", "a:z"]);
  });
});

describe("the database does the deciding (20270527109000_crew_ugc_safety.sql)", () => {
  it("checks every Crew write on the server: posts and stories, comments, message requests, bios", () => {
    expect(sql).toContain("CREATE TRIGGER community_posts_crew_guard BEFORE INSERT OR UPDATE OF caption, quote, sticker ON public.community_posts");
    expect(sql).toContain("CREATE TRIGGER community_comments_crew_guard BEFORE INSERT OR UPDATE OF body ON public.community_comments");
    expect(sql).toContain("CREATE TRIGGER group_messages_crew_request_guard BEFORE INSERT ON public.group_messages");
    expect(sql).toContain("CREATE TRIGGER community_profiles_crew_bio_guard BEFORE INSERT OR UPDATE OF bio ON public.community_profiles");
    // refused with a short neutral message the app shows as it is
    expect(sql).toContain("MESSAGE = 'This can''t be posted. It goes against the Crew community rules.'");
    // borderline words are saved and queued, never refused
    expect(sql).toContain("PERFORM public.crew_filter_flag('post', NEW.id, NEW.author_user_id, v,");
  });

  it("never refuses a write made inside another trigger (a finished workout's automatic story), and never filters staff or the system", () => {
    expect(sql).toContain("v_direct boolean := pg_trigger_depth() <= 1;");
    expect(sql).toContain("IF v->>'verdict' = 'block' AND v_direct THEN PERFORM public.crew_filter_refuse(); END IF;");
    expect(sql).toContain("IF uid IS NULL OR public.community_is_staff(uid) THEN RETURN NEW; END IF;");
    expect(sql).toContain("IF TG_OP = 'INSERT' AND v_direct AND NOT coalesce(NEW.auto_shared, false) THEN");
  });

  it("asks for the Community rules once, and holds a suspension, on the server", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.community_rules_acceptances");
    expect(sql).toContain("HINT = 'crew_rules'");
    expect(sql).toContain("HINT = 'crew_suspended'");
  });

  it("hides what you reported from you in the feeds, the story rail and profiles (community_feed) and comments", () => {
    const line = "AND NOT EXISTS (SELECT 1 FROM public.community_reports rr\n                        WHERE rr.reporter_id = uid AND rr.target_kind = 'post' AND rr.target_id = p.id)";
    expect(sql.split("CREATE OR REPLACE FUNCTION public.community_feed(")[1]).toContain(line);
    expect(sql.split("CREATE OR REPLACE FUNCTION public.community_feed_ranked(")[1]).toContain(line);
    expect(sql).toContain("reported AS (SELECT r.target_id AS id FROM public.community_reports r\n                  WHERE r.reporter_id = uid AND r.target_kind = 'comment')");
  });

  it("hides it for everyone after N independent reports (default 3) until staff decide, and the hold sticks", () => {
    expect(sql).toContain("auto_hide_reports integer NOT NULL DEFAULT 3");
    expect(sql).toContain("response_hours integer NOT NULL DEFAULT 24");
    expect(sql).toContain("archived_reason = 'reported'");
    expect(sql).toContain("CREATE TRIGGER community_posts_moderation_hold BEFORE UPDATE ON public.community_posts");
    expect(sql).toContain("RAISE EXCEPTION 'The JF Effect team is reviewing this post'");
  });

  it("blocks hide comments and an opened post both ways (they already hid the feed, stories, profiles and messages)", () => {
    expect(sql).toContain("AND c.author_user_id NOT IN (SELECT id FROM blocked)");
    expect(sql).toContain("OR p.author_user_id NOT IN (SELECT public.community_blocked_authors()));");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.community_blocked_client_ids()");
  });

  it("gives staff four actions, every one logged, and keeps older builds' Remove / Dismiss working", () => {
    expect(sql).toContain("IF _action NOT IN ('remove', 'keep', 'warn', 'suspend') THEN");
    expect(sql).toContain("INSERT INTO public.community_moderation_actions (target_kind, target_id, target_owner, action, note, days, acted_by)");
    expect(sql).toContain("PERFORM public.community_moderate(_kind, _target, CASE WHEN _action = 'remove' AND _kind <> 'profile' THEN 'remove' ELSE 'keep' END);");
  });

  it("RLS: reporters file and read only their own reports, staff read everything; new tables have RLS, checked once per query", () => {
    expect(sql).toContain("WITH CHECK (reporter_id = (SELECT auth.uid()) AND source = 'member' AND status = 'open');");
    expect(sql).toContain("USING (reporter_id = (SELECT auth.uid()));");
    expect(sql).toContain("GRANT INSERT (reporter_id, target_kind, target_id, reason, details) ON public.community_reports TO authenticated;");
    for (const t of ["community_moderation_settings", "community_rules_acceptances", "community_member_sanctions", "community_moderation_actions"]) {
      expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`SELECT public.rls_evaluate_once('${t}');`);
    }
    // a report's owner and snapshot are always the server's, never what the phone sent
    expect(sql).toContain("v := public.community_report_target(NEW.target_kind, NEW.target_id);");
  });
});

describe("the app side", () => {
  it("Report (with Block in the same sheet) on posts, stories, comments and profiles", () => {
    const report = read("src/components/community/report-sheet.tsx");
    expect(report).toContain('export type ReportKind = "post" | "story" | "comment" | "program" | "profile";');
    expect(report).toContain("data-report-block");
    expect(report).toContain('toast.success("Report sent"');
    expect(report).toContain("hideReportedLocally(qc, serverKind, targetId, postId);");
    expect(read("src/components/community/post-actions.tsx")).toContain('<ReportSheet kind={post.story ? "story" : "post"}');
    expect(read("src/components/community/post-actions.tsx")).toContain("data-block-post-author");
    expect(read("src/components/community/comments-sheet.tsx")).toContain('<ReportSheet kind="comment"');
    expect(read("src/components/community/profile-view.tsx")).toContain('<ReportSheet kind="profile"');
    expect(read("src/components/community/story-menu.tsx")).toContain('<ReportSheet kind="story"');
    expect(read("src/components/community/crew-stories.tsx")).toContain("<StoryOthersMenuSheet");
  });

  it("asks for the Community rules when the server does, and posts again on Agree", () => {
    const q = read("src/lib/community.queries.ts");
    expect(q).toContain('withCrewRules(() => db.rpc("community_add_comment"');
    expect(q).toContain('withCrewRules(() => db.rpc("community_create_post"');
    expect(q).toContain('db.rpc("community_save_post"');
    expect(read("src/components/app-shell.tsx")).toContain("<CrewRulesHost />");
  });

  it("the queue has Remove, Keep, Warn, Suspend and the 24-hour clock; Help publishes the contact email", () => {
    const queue = read("src/components/community/reports-review.tsx");
    for (const a of ["data-moderation-remove", "data-moderation-keep", "data-moderation-warn", "data-moderation-suspend", "data-moderation-due"]) {
      expect(queue).toContain(a);
    }
    expect(queue).toContain('db.rpc("community_moderate"');
    expect(read("src/components/tutorials/tutorials.tsx")).toContain("data-help-contact");
    expect(read("src/lib/crew-safety.ts")).toContain('CREW_CONTACT_EMAIL = "support@jfeffect.com"');
  });

  it("staff hear about flagged items from the hourly tick, deduped with the instant report push", () => {
    expect(read("src/lib/push/scheduled-pushes.server.ts")).toContain("notifyWaitingCrewReports(admin, now)");
    const tick = read("src/lib/push/crew-reports.server.ts");
    expect(tick).toContain('rateKey: "crew_report", rateWindowMinutes: 30, priority: "normal"');
    expect(read("src/lib/push/events.functions.ts")).toContain('.update({ notified_at: new Date().toISOString() })');
  });
});
