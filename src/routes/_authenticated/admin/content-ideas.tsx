import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";
export const Route = createFileRoute("/_authenticated/admin/content-ideas")({ component: () => <ComingSoon title="Content Ideas" phase="Phase 3" /> });