import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PageHeader } from "@/components/app-shell";
import { ImportStart } from "@/components/program-import/import-start";
import { ImportFlow } from "@/components/program-import/import-review";

// Import a program from a file or pasted text; ?id=<import> is one being read or reviewed.
export const Route = createFileRoute("/_authenticated/portal/programs/import")({
  validateSearch: z.object({
    id: z.string().uuid().optional(),
    paste: z.coerce.number().optional(),
  }),
  component: function ImportProgramPage() {
    const { id, paste } = Route.useSearch();
    if (id) return <ImportFlow key={id} id={id} />;
    return (
      <div className="mx-auto w-full max-w-2xl pb-28">
        <PageHeader title="Import a program" backTo="/portal/programs" />
        <ImportStart key={paste ? "paste" : "file"} startWithPaste={!!paste} />
      </div>
    );
  },
});
