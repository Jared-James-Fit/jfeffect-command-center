import { createFileRoute, redirect } from "@tanstack/react-router";

// Convenience alias → canonical /legal/terms-of-service page.
export const Route = createFileRoute("/terms")({
  beforeLoad: () => { throw redirect({ to: "/legal/$slug", params: { slug: "terms-of-service" } }); },
});