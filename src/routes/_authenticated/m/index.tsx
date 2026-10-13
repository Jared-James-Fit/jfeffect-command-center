import { createFileRoute } from "@tanstack/react-router";

// /m itself: the layout sends it to /portal (this route only has to exist).
export const Route = createFileRoute("/_authenticated/m/")({ component: () => null });
