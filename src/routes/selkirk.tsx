import { createFileRoute, redirect } from "@tanstack/react-router";

// The old Selkirk address: online coaching (personal-trainer-selkirk.tsx).
export const Route = createFileRoute("/selkirk")({
  beforeLoad: () => {
    throw redirect({ to: "/coaching", replace: true });
  },
  head: () => ({
    links: [{ rel: "canonical", href: "https://jfeffect.com/coaching" }],
  }),
  component: () => null,
});
