import { createFileRoute } from "@tanstack/react-router";
import { PlanLibrary } from "@/route-pages/_authenticated/m/plans";

export const Route = createFileRoute("/_authenticated/m/plans")({ component: PlanLibrary });
