import { createFileRoute, redirect } from "@tanstack/react-router";

// Removed page: its address only redirects, so an old link never 404s.
// Guest signing for native agreement packages: none was ever sent or signed.
export const Route = createFileRoute("/sign/$token")({
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true });
  },
});
