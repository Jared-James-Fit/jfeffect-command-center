import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/_authenticated/admin/google-calendar")({
  validateSearch: z.object({ connected: z.string().optional(), error: z.string().optional() }).parse,
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/admin/calendar",
      search: { tab: "booking", connected: search.connected, error: search.error } as any,
    });
  },
});
