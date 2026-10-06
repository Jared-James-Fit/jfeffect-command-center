import { createFileRoute } from "@tanstack/react-router";
import { PaymentsRedirect } from "@/route-pages/_authenticated/admin/payments";

export const Route = createFileRoute("/_authenticated/admin/payments")({ component: PaymentsRedirect });
