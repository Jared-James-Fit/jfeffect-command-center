import { createFileRoute } from "@tanstack/react-router";
import { StaffRedirect } from "@/route-pages/_authenticated/admin/staff";

export const Route = createFileRoute("/_authenticated/admin/staff")({
  component: StaffRedirect,
});
