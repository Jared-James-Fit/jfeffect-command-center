/**
 * The cover-headline pass over the automated posts already out and the
 * library's decks (post-headlines.ts): a batch at a time, from the
 * `post-headlines-tick` hook (pg_cron every 15 minutes while any are left,
 * and the admin's Refresh). Each deck is looked at once per HEADLINE_VERSION
 * (`community_post_headlines`): a cover that reads in the grid is kept as
 * it is; one that doesn't is rewritten by the writer model on the OpenAI key
 * (route `post_write`, never Lovable credits), checked by code, and written
 * in place by the database (`community_post_headline_apply`: the same post,
 * date, likes, comments and views; only while the title is still the one
 * read; the old one kept for Undo). A post the coach edited is his and is
 * left alone.
 */
import { askRoute } from "@/lib/ai/route-call.server";
import { HEADLINE_SYSTEM, HEADLINE_VERSION, deckSource, headlinePrompt, headlineProblems, needsHeadlinePolish, readHeadline } from "@/lib/post-headlines";
import { parseDeck } from "@/lib/post-decks";

type Admin = any;

export type HeadlineRow = { kind: "post" | "item"; id: string; title: string | null; deck: unknown; edited: boolean };

export type HeadlineOutcome = { id: string; kind: string; status: "kept" | "done" | "failed" | "skipped"; before?: string | null; after?: string | null; problems?: string[] };

async function record(admin: Admin, row: HeadlineRow, out: Omit<HeadlineOutcome, "id" | "kind">, model: string | null = null) {
  await admin.from("community_post_headlines").upsert(
    {
      post_id: row.kind === "post" ? row.id : null,
      item_id: row.kind === "item" ? row.id : null,
      version: HEADLINE_VERSION,
      status: out.status,
      old_title: out.before ?? row.title,
      new_title: out.after ?? null,
      problems: out.problems ?? null,
      model,
      applied_at: out.status === "done" ? new Date().toISOString() : null,
    },
    { onConflict: row.kind === "post" ? "post_id,version" : "item_id,version", ignoreDuplicates: false },
  );
}

/** Look at one deck's cover and fix it if it needs it. */
export async function polishOne(admin: Admin, row: HeadlineRow): Promise<HeadlineOutcome> {
  const base = { id: row.id, kind: row.kind };
  const deck = parseDeck(row.deck);
  const cover = deck?.slides[0];
  if (!deck || cover?.type !== "cover") {
    await record(admin, row, { status: "skipped", problems: ["no deck"] });
    return { ...base, status: "skipped" };
  }
  if (row.edited) {
    await record(admin, row, { status: "skipped", problems: ["the coach edited this post"] });
    return { ...base, status: "skipped" };
  }
  if (!needsHeadlinePolish(cover.title)) {
    await record(admin, row, { status: "kept" });
    return { ...base, status: "kept", before: cover.title };
  }
  const source = deckSource(deck);
  let notes: string[] = [];
  let model: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const reply = await askRoute("post_write", { system: HEADLINE_SYSTEM, prompt: headlinePrompt(deck, notes), timeoutMs: 60_000, tag: "post_write:headline" }, { sb: admin, openaiOnly: true });
    model = (reply as { model?: string }).model ?? model;
    const next = readHeadline(reply.text ?? "");
    notes = next ? headlineProblems(next, cover.title, source) : ["the answer wasn't the JSON asked for"];
    if (next && !notes.length) {
      const { data, error } = await admin.rpc("community_post_headline_apply", {
        _post: row.kind === "post" ? row.id : null,
        _item: row.kind === "item" ? row.id : null,
        _old: cover.title,
        _new: next,
      });
      if (error) throw new Error(error.message);
      const status = data === "applied" ? "done" : "skipped";
      await record(admin, row, { status, before: cover.title, after: next, problems: status === "done" ? undefined : [String(data)] }, model);
      return { ...base, status, before: cover.title, after: next };
    }
  }
  await record(admin, row, { status: "failed", before: cover.title, problems: notes }, model);
  return { ...base, status: "failed", before: cover.title, problems: notes };
}

/** One batch: the next decks not looked at for this version. */
export async function runHeadlineBatch(admin: Admin, limit = 4): Promise<{ done: HeadlineOutcome[]; left: boolean }> {
  const { data, error } = await admin.rpc("community_post_headlines_next", { _version: HEADLINE_VERSION, _limit: limit });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as HeadlineRow[];
  const done: HeadlineOutcome[] = [];
  for (const r of rows) {
    try {
      done.push(await polishOne(admin, r));
    } catch (e: any) {
      // a provider failure: nothing recorded, so the next run tries it again
      done.push({ id: r.id, kind: r.kind, status: "failed", problems: [String(e?.message ?? e)] });
      break;
    }
  }
  return { done, left: rows.length === limit };
}
