import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/_authenticated/admin/messages")({
  // `msg`: open the chat on that message (scrolled to and highlighted), e.g. a check-in from the dashboard.
  // `recovery`: open the Recovery queue on that item (a push about a reply waiting for approval).
  validateSearch: (s) => z.object({ client: z.string().uuid().optional(), msg: z.string().uuid().optional().catch(undefined), recovery: z.string().uuid().optional().catch(undefined) }).parse(s),
  // Redirect before anything mounts. The old component-level redirect rendered
  // an empty page, then navigated a second time once effects ran: a visible
  // blank frame on every tap of the Messages nav item.
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/admin/communication",
      search: {
        tab: "messages",
        ...(search.client ? { client: search.client } : {}),
        ...(search.client && search.msg ? { msg: search.msg } : {}),
        ...(search.recovery ? { recovery: search.recovery } : {}),
      } as any,
      replace: true,
    });
  },
});
