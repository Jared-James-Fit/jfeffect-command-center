import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cleanPollOptions, pollPercents, votePoll, type CommunityPoll } from "@/lib/community";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261023090000_community_polls.sql");
const card = read("src/components/community/poll.tsx");
const editor = read("src/components/community/note-editor.tsx");
const postCard = read("src/components/community/post-card.tsx");
const hub = read("src/components/community/admin-community-hub.tsx");
const queries = read("src/lib/community.queries.ts");

const poll = (votes: number[], my: string | null = null): CommunityPoll => ({
  options: votes.map((v, i) => ({ id: `o${i}`, label: `Option ${i}`, votes: v })),
  total: votes.reduce((a, b) => a + b, 0),
  my_vote: my,
});

describe("voting", () => {
  it("a first vote adds one", () => {
    const p = votePoll(poll([3, 5, 4]), "o1");
    expect(p.options.map((o) => o.votes)).toEqual([3, 6, 4]);
    expect(p.total).toBe(13);
    expect(p.my_vote).toBe("o1");
  });
  it("switching moves the vote, the total stays", () => {
    const p = votePoll(poll([3, 6, 4], "o1"), "o2");
    expect(p.options.map((o) => o.votes)).toEqual([3, 5, 5]);
    expect(p.total).toBe(13);
  });
  it("taking it back removes it; voting the same twice changes nothing", () => {
    expect(votePoll(poll([3, 6, 4], "o1"), null).options.map((o) => o.votes)).toEqual([3, 5, 4]);
    const same = poll([1, 1], "o0");
    expect(votePoll(same, "o0")).toBe(same);
  });
});

describe("percentages", () => {
  it("equal votes always show the same number", () => {
    expect(pollPercents(poll([3, 5, 5]))).toEqual([23, 38, 38]);
  });
  it("nobody voted: zeros, no divide by zero", () => {
    expect(pollPercents(poll([0, 0]))).toEqual([0, 0]);
  });
});

describe("writing a poll", () => {
  it("2-4 different options, each up to 60 characters; blanks dropped", () => {
    expect(cleanPollOptions([" Squat ", "Bench", ""])).toEqual({ ok: true, options: ["Squat", "Bench"] });
    expect(cleanPollOptions(["Squat"])).toMatchObject({ ok: false });
    expect(cleanPollOptions(["Squat", "squat"])).toEqual({ ok: false, reason: "Each option needs to be different" });
    expect(cleanPollOptions(["a", "x".repeat(61)])).toMatchObject({ ok: false });
  });
  it("only the coach's Write a post offers it; the text is the question", () => {
    expect(hub).toContain("allowPoll");
    expect(hub).toContain('await act.mutateAsync({ kind: "note", body, poll, media });');
    expect(editor).toContain('placeholder={poll ? "Ask the crew something…" : undefined}');
    expect(editor).toContain("disabled={saving || !trimmed || !pollReady || draft.tray.uploading > 0}");
    // a poll (and photos) only go when there are some
    expect(queries).toContain('...(a.poll?.length ? { _poll: a.poll } : {}),');
    expect(queries).toContain('...(a.media?.length ? { _media: a.media } : {}),');
  });
});

describe("polls on the server", () => {
  it("same rules as the app, checked again on the server; coach only", () => {
    expect(sql).toContain("IF uid IS NULL OR NOT public.community_is_coach(uid) THEN RAISE EXCEPTION 'Not allowed'");
    expect(sql).toContain("NOT BETWEEN 2 AND 4 THEN RAISE EXCEPTION 'A poll needs 2 to 4 options'");
    expect(sql).toContain("RAISE EXCEPTION 'Each option needs to be different'");
  });
  it("older app versions still post (body only)", () => {
    expect(sql).toContain("DROP FUNCTION IF EXISTS public.community_create_note(text);");
    expect(sql).toContain("community_create_note(_body text, _poll text[] DEFAULT NULL)");
  });
  it("one vote per person (a coach's two logins count once), only options on that poll, only posts you can see", () => {
    expect(sql).toContain("PRIMARY KEY (post_id, user_id)");
    expect(sql).toContain("v_me := public.community_main_account(uid);");
    expect(sql).toContain("RAISE EXCEPTION 'That option isn''t on this poll';");
    expect(sql).toContain("public.community_post_visible(p.visibility, p.author_user_id, p.client_id)");
  });
  it("who voted what: the poster and the coach only", () => {
    const voters = sql.slice(sql.indexOf("'voters', CASE"), sql.indexOf("END)", sql.indexOf("'voters', CASE")));
    expect(voters).toContain("public.community_is_coach(_viewer)");
    expect(voters).toContain("p.author_user_id = me.uid");
  });
  it("tables are read and written through the functions only, and nothing pushes", () => {
    expect(sql).toContain("ALTER TABLE public.community_poll_options ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain("ALTER TABLE public.community_poll_votes ENABLE ROW LEVEL SECURITY;");
    expect(sql).not.toMatch(/CREATE POLICY/);
    expect(sql).not.toMatch(/app_event|send_push|net\.http_post/);
  });
  it("every post carries its poll", () => {
    expect(sql).toContain("'poll', public.community_poll_json(n.id, _viewer),");
  });
});

describe("the poll card", () => {
  it("results show once you've voted (or it's yours); the bars grow in", () => {
    expect(card).toContain("const showResults = !!poll && (!!poll.my_vote || post.is_mine);");
    expect(card).toContain('style={{ width: grown ? `${pct[i]}%` : "0%" }}');
    expect(card).toContain("vote to see results");
  });
  it("tapping it never opens or likes the post", () => {
    expect(card).toContain("onClick={(e) => e.stopPropagation()}");
  });
  it("sits under the words of the post, in the feed and the detail", () => {
    expect(postCard).toContain("{post.poll && <PollCard post={post} onOpenPerson={onOpenPerson} className=\"mb-2\" />}");
  });
});
