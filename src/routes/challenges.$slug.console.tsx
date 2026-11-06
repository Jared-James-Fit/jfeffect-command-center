import { createFileRoute } from "@tanstack/react-router";
import { EventConsole } from "@/components/challenges/console";

// Event staff's phone on the day: register, check in, judge. The database
// decides who may do what (a judge, registration staff, a manager, the owner).
export const Route = createFileRoute("/challenges/$slug/console")({
  head: () => ({ meta: [{ title: "Event console | JF Effect" }, { name: "robots", content: "noindex" }] }),
  component: function ConsoleRoute() {
    const { slug } = Route.useParams();
    return <EventConsole slug={slug} />;
  },
});
