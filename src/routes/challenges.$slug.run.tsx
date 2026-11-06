import { createFileRoute } from "@tanstack/react-router";
import { RunEvent } from "@/components/challenges/run-event";

/** Event day: register, judge and watch the board, from a phone. Staff only. */
export const Route = createFileRoute("/challenges/$slug/run")({
  head: () => ({
    meta: [{ title: "Run event | JF Effect Challenges" }, { name: "robots", content: "noindex" }],
  }),
  component: Page,
});

function Page() {
  const { slug } = Route.useParams();
  return <RunEvent slug={slug} />;
}
