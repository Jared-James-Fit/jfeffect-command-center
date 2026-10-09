import { createFileRoute, redirect } from "@tanstack/react-router";

/** Old /book/?slug=… links go to the booking page itself. */
export const Route = createFileRoute("/book/")({
  beforeLoad: ({ search }) => {
    const s = search as Record<string, unknown>;
    const slug = typeof s.slug === "string" ? s.slug : "";
    if (!slug) throw redirect({ to: "/" });
    const { slug: _drop, ...rest } = s;
    throw redirect({ to: "/book/$slug", params: { slug }, search: rest as any });
  },
});
