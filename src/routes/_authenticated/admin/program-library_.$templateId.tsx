import { createFileRoute } from "@tanstack/react-router";
import { TemplateEditor, TemplateEditorErrorFallback } from "@/route-pages/_authenticated/admin/program-library_.$templateId";

export const Route = createFileRoute("/_authenticated/admin/program-library_/$templateId")({
  component: TemplateEditor,
  errorComponent: TemplateEditorErrorFallback,
  validateSearch: (s: Record<string, unknown>): { block?: string } => ({
    block: typeof s.block === "string" ? (s.block as string) : undefined,
  }),
});
