import { createFileRoute } from "@tanstack/react-router";
import { ResourcesRedirect } from "@/route-pages/_authenticated/admin/resources";

export const Route = createFileRoute("/_authenticated/admin/resources")({
  component: ResourcesRedirect,
});
