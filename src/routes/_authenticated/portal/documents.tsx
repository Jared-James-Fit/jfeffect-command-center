import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";
export const Route = createFileRoute("/_authenticated/portal/documents")({ component: () => <ComingSoon title="Documents" phase="Phase 2" /> });