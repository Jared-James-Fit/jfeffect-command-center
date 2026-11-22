import { createFileRoute } from "@tanstack/react-router";
import { MyDocumentsPage } from "@/components/documents/documents-pages";

// Account → Documents: a person's own files and what their coach shared with them.
export const Route = createFileRoute("/_authenticated/portal/documents")({
  component: MyDocumentsPage,
});
