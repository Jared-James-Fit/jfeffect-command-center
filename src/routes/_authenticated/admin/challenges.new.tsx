import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { StartChallenge } from "@/components/challenges/admin/challenge-wizard";

/** A new challenge starts from a kind, a template or a past event, and is saved as a draft at once. */
export const Route = createFileRoute("/_authenticated/admin/challenges/new")({
  head: () => ({ meta: [{ title: "New challenge" }] }),
  component: NewChallenge,
});

function NewChallenge() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-4">
      <Link
        to="/admin/challenges"
        className="-ml-1 flex h-10 w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Challenges
      </Link>
      <h1 className="mb-5 mt-1 text-2xl font-semibold">New challenge</h1>
      <StartChallenge />
    </div>
  );
}
