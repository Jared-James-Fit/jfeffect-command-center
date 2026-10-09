import { createFileRoute } from "@tanstack/react-router";
import { AdminCommunityHub } from "@/components/community/admin-community-hub";

/**
 * The coach's Community page: the week at a glance and what needs you, then
 * Feed / Daily posts / Birthdays, and "+ Post". `#post=<id>` opens a post,
 * `#birthday=<id>` or `#tab=birthdays` / `#tab=daily` opens that tab.
 */
export const Route = createFileRoute("/_authenticated/admin/community")({
  head: () => ({ meta: [{ title: "Community" }] }),
  component: AdminCommunityHub,
});
