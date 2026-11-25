/**
 * Pure pieces of Crew moderation (tested in crew-moderation.test.ts): the
 * queue's 24-hour clock and labels, and the filters that take reported posts,
 * comments and blocked people off this phone's lists.
 */
import type { InfiniteData } from "@tanstack/react-query";

export type ModerationKind = "post" | "comment" | "program" | "profile" | "message";

/** What a queue item is, in a word ("Story" for a post that's a story). */
export function moderationKindLabel(kind: ModerationKind, snapshot?: { story?: boolean | null } | null): string {
  if (kind === "post") return snapshot?.story ? "Story" : "Post";
  return { comment: "Comment", program: "Program", profile: "Account", message: "Message request" }[kind];
}

/**
 * The response clock on a queue item: "18 h left", "Under 1 h left", or
 * "2 h overdue" (`late` true). The target is 24 hours from the first report.
 */
export function moderationDue(dueAt: string | null | undefined, now: number = Date.now()): { label: string; late: boolean } | null {
  if (!dueAt) return null;
  const ms = new Date(dueAt).getTime() - now;
  if (!Number.isFinite(ms)) return null;
  const hours = Math.floor(Math.abs(ms) / 3_600_000);
  if (ms < 0) return { label: hours < 1 ? "Just overdue" : `${hours} h overdue`, late: true };
  return { label: hours < 1 ? "Under 1 h left" : `${hours} h left`, late: false };
}

type FeedPage = { posts: { id: string }[] };

/** Feed pages without the given posts. */
export function withoutPosts<P extends FeedPage>(data: InfiniteData<P> | undefined, ids: ReadonlySet<string>): InfiniteData<P> | undefined {
  if (!data?.pages || !ids.size) return data;
  return { ...data, pages: data.pages.map((pg) => ({ ...pg, posts: pg.posts.filter((p) => !ids.has(p.id)) })) };
}

/** A thread without one comment and the replies under it. */
export function withoutComment<C extends { id: string; parent_id?: string | null }>(list: C[] | undefined, id: string): C[] | undefined {
  return list?.filter((c) => c.id !== id && c.parent_id !== id);
}

/**
 * Board rows without people blocked either way (ranks stay what the database
 * gave). A row names its person by `client_id`, or a Hall roster row by its
 * `key` ("c:<client id>").
 */
export function withoutBlocked<R extends { client_id?: string | null; key?: string }>(rows: R[], blocked: readonly string[] | undefined): R[] {
  if (!blocked?.length) return rows;
  const set = new Set(blocked);
  return rows.filter((r) => {
    const id = r.client_id ?? (r.key?.startsWith("c:") ? r.key.slice(2) : null);
    return !id || !set.has(id);
  });
}
