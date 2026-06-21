import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/selkirk")({
  beforeLoad: () => {
    throw redirect({ to: "/personal-trainer-selkirk", replace: true });
  },
  head: () => ({
    links: [{ rel: "canonical", href: "https://jfeffect.com/personal-trainer-selkirk" }],
  }),
  component: () => null,
});
