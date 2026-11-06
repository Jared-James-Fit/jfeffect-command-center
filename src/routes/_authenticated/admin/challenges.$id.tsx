import { createFileRoute } from "@tanstack/react-router";
import { AdminChallengeManage } from "@/components/challenges/admin/challenge-manage";

export const Route = createFileRoute("/_authenticated/admin/challenges/$id")({
  head: () => ({ meta: [{ title: "Challenge" }] }),
  component: Page,
});

function Page() {
  const { id } = Route.useParams();
  return <AdminChallengeManage key={id} id={id} />;
}
