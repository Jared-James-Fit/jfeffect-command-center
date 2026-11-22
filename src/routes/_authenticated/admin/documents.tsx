import { createFileRoute } from "@tanstack/react-router";
import { StaffDocumentsPage } from "@/components/documents/documents-pages";

// A staff member's own documents (private to them); a client's are on their profile's Documents tab.
export const Route = createFileRoute("/_authenticated/admin/documents")({
  component: StaffDocumentsPage,
});
