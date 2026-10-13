import { createFileRoute } from "@tanstack/react-router";
import { PortalPlanLibrary } from "@/route-pages/_authenticated/portal/plans";

export const Route = createFileRoute("/_authenticated/portal/plans/")({ component: PortalPlanLibrary });
