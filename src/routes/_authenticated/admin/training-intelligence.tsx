import { createFileRoute } from "@tanstack/react-router";
import { TrainingIntelRedirect } from "@/route-pages/_authenticated/admin/training-intelligence";

export const Route = createFileRoute("/_authenticated/admin/training-intelligence")({ component: TrainingIntelRedirect });
