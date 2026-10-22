import { createFileRoute } from "@tanstack/react-router";
import { AdminCommunityHub } from "@/components/community/admin-community-hub";

/**
 * The coach's Crew page: Feed (what needs you, then the feed) / Posts (what
 * goes out on its own) / Insights, and + to write a post. `#post=<id>` opens a
 * post, `#tab=posts` / `#tab=insights` that tab (old `#tab=daily`,
 * `#tab=birthdays` and `#birthday=<id>` open Posts; `#tab=league` goes to
 * /admin/league).
 */
export const Route = createFileRoute("/_authenticated/admin/community")({
  head: () => ({ meta: [{ title: "Crew" }] }),
  component: AdminCommunityHub,
});
