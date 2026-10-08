import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/_authenticated/admin/messages")({
  validateSearch: (s) => z.object({ client: z.string().uuid().optional() }).parse(s),
  // Redirect before anything mounts. The old component-level redirect rendered
  // an empty page, then navigated a second time once effects ran: a visible
  // blank frame on every tap of the Messages nav item.
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/admin/communication",
      search: { tab: "messages", ...(search.client ? { client: search.client } : {}) } as any,
      replace: true,
    });
  },
});
