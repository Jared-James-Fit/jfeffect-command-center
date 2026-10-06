import { createFileRoute } from "@tanstack/react-router";
import { BroadcastsRedirect } from "@/route-pages/_authenticated/admin/broadcasts";

export const Route = createFileRoute("/_authenticated/admin/broadcasts")({ component: BroadcastsRedirect });
