import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ActivatePage } from "@/components/join/activate-page";
import { shareMeta } from "@/lib/share-meta";

// /activate?a=<signed application token>[&k=<email proof>]: an approved
// applicant sets their password (membership-apply.ts, activate-page.tsx).
export const Route = createFileRoute("/activate")({
  validateSearch: (s) =>
    z
      .object({ a: z.string().max(120).optional(), k: z.string().max(64).optional() })
      .catch({})
      .parse(s),
  head: () => ({
    meta: [
      { title: "You're approved | JF Effect" },
      { name: "robots", content: "noindex" },
      ...shareMeta({
        title: "JF Effect",
        description: "You're approved. Set your password and you're in.",
        path: "/activate",
      }),
    ],
  }),
  component: ActivateRoute,
});

function ActivateRoute() {
  const { a, k } = Route.useSearch();
  return <ActivatePage token={a ?? null} proof={k ?? null} />;
}
