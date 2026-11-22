import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { WorkspacePage } from "@/components/coach-workspace/workspace-page";

// A coach's own workspace (invite-only pilot, off in production): the server
// checks the caller's role in that business on every read and write.
export const Route = createFileRoute("/_authenticated/workspace")({
  validateSearch: (s) => z.object({ org: z.string().uuid().optional() }).catch({}).parse(s),
  head: () => ({ meta: [{ title: "Workspace · JF Effect" }, { name: "robots", content: "noindex" }] }),
  component: WorkspaceRoute,
});

function WorkspaceRoute() {
  const { org } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return <WorkspacePage orgId={org} onPick={(id) => navigate({ search: { org: id }, replace: true })} />;
}
