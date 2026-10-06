import { createFileRoute } from "@tanstack/react-router";
import { CardioRedirect } from "@/route-pages/_authenticated/admin/cardio-targets";

export const Route = createFileRoute("/_authenticated/admin/cardio-targets")({ component: CardioRedirect });
