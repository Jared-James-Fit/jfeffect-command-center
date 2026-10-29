import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The client's schedule lives in their Training tab now (one place for the
 * program and its calendar); old links and "Manage Schedule" land there.
 */
export const Route = createFileRoute("/_authenticated/admin/clients/$id/schedule")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/admin/clients/$id",
      params: { id: params.id },
      search: { tab: "training" },
      hash: "schedule",
      replace: true,
    });
  },
});
