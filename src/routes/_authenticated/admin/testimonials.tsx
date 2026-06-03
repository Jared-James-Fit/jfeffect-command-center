import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";
export const Route = createFileRoute("/_authenticated/admin/testimonials")({ component: () => <ComingSoon title="Testimonials & Transformations" phase="Phase 3" /> });