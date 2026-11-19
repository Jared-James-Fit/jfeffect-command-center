import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { detailPlan, useProgram, type ProgramDraft } from "@/lib/athlete-programs";
import { newPlan } from "@/lib/program-plan";
import { useProgramEditor } from "./use-program-editor";
import { ProgramWorkbench } from "./workbench/program-workbench";

/**
 * Build or edit your own program: blocks of weeks of training days, each a
 * list of library exercises with sets, reps, effort, load and rest. A new one
 * starts as 12 weeks that follow week 1 until a week is changed. Saved
 * privately; sharing is a switch on the program's page. One screen for phones
 * and computers (ProgramWorkbench).
 */
export function ProgramBuilder({ editId }: { editId: string | null }) {
  const { data: existing, isLoading } = useProgram(editId);
  if (editId && isLoading) {
    return (
      <div className="mx-auto w-full max-w-2xl pb-28">
        <PageHeader title="Edit program" backTo="/portal/programs" />
        <div className="space-y-3 px-4 py-3 md:px-8" aria-hidden>
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
      </div>
    );
  }
  if (editId && (!existing || !existing.is_mine)) {
    return (
      <div className="mx-auto w-full max-w-2xl pb-28">
        <PageHeader title="Edit program" backTo="/portal/programs" />
        <div className="px-4 py-6 text-center text-sm text-muted-foreground md:px-8">
          You can only edit your own programs.{" "}
          <Link to="/portal/programs" className="underline">
            Back to programs
          </Link>
        </div>
      </div>
    );
  }
  return <Builder existing={existing ?? null} />;
}

function Builder({ existing }: { existing: ReturnType<typeof useProgram>["data"] | null }) {
  // made once: a refetch while editing never resets the draft
  const [start] = useState<ProgramDraft>(() =>
    existing
      ? {
          id: existing.id,
          title: existing.title,
          description: existing.description ?? "",
          goal: existing.goal,
          level: existing.level,
          plan: detailPlan(existing),
        }
      : { id: null, title: "", description: "", goal: null, level: null, plan: newPlan(12) },
  );
  const editor = useProgramEditor(start, existing?.updated_at ?? null);
  return <ProgramWorkbench editor={editor} />;
}
