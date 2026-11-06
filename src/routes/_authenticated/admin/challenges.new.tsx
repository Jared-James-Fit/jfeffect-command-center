import { createFileRoute, Link } from "@tanstack/react-router";
import { ChallengeBuilder } from "@/components/challenges/admin/challenge-builder";

export const Route = createFileRoute("/_authenticated/admin/challenges/new")({
  head: () => ({ meta: [{ title: "New challenge" }] }),
  component: NewChallenge,
});

function NewChallenge() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-4">
      <Link to="/admin/challenges" className="text-sm text-muted-foreground hover:text-foreground">
        ‹ Challenges
      </Link>
      <h1 className="mb-5 mt-2 text-2xl font-semibold">New challenge</h1>
      <ChallengeBuilder />
    </div>
  );
}
