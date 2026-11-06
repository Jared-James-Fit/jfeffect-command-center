import { createFileRoute } from "@tanstack/react-router";
import { ChallengeWizard } from "@/components/challenges/admin/challenge-wizard";
import type { WizardStep } from "@/lib/challenges/wizard";

/** The challenge builder: Basics, Scoring, Registration & prizes, Review & publish. Autosaves. */
export const Route = createFileRoute("/_authenticated/admin/challenges/$id/edit")({
  validateSearch: (s: Record<string, unknown>): { step?: WizardStep } => {
    const n = Number(s.step);
    return n === 1 || n === 2 || n === 3 || n === 4 ? { step: n } : {};
  },
  head: () => ({ meta: [{ title: "Edit challenge" }] }),
  component: Page,
});

function Page() {
  const { id } = Route.useParams();
  const { step } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <div className="mx-auto max-w-2xl px-4 py-4">
      <ChallengeWizard
        id={id}
        step={step ?? 1}
        onStep={(s) => void navigate({ search: { step: s }, replace: true })}
      />
    </div>
  );
}
