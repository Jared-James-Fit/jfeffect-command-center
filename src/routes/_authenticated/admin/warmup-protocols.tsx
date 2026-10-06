import { createFileRoute } from "@tanstack/react-router";
import { WarmupRedirect } from "@/route-pages/_authenticated/admin/warmup-protocols";

export const Route = createFileRoute("/_authenticated/admin/warmup-protocols")({ component: WarmupRedirect });
