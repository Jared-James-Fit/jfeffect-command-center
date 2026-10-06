import { createFileRoute } from "@tanstack/react-router";
import { NativeFormsRedirect } from "@/route-pages/_authenticated/admin/native-forms";

export const Route = createFileRoute("/_authenticated/admin/native-forms")({
  component: NativeFormsRedirect,
});
