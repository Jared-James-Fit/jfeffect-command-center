import { createFileRoute } from "@tanstack/react-router";

// Any old /m/... link (emails, bookmarks, Stripe returns): it has to match a
// route so the layout runs and sends it to the same screen in the portal,
// instead of the 404 page.
export const Route = createFileRoute("/_authenticated/m/$")({ component: () => null });
