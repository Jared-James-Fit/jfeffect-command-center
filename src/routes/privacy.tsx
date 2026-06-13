import { createFileRoute, redirect } from "@tanstack/react-router";

// Convenience alias → canonical /legal/privacy-policy page.
export const Route = createFileRoute("/privacy")({
  beforeLoad: () => { throw redirect({ to: "/legal/$slug", params: { slug: "privacy-policy" } }); },
});