import { createFileRoute } from "@tanstack/react-router";
import { PaymentLinksRedirect } from "@/route-pages/_authenticated/admin/payment-links";

export const Route = createFileRoute("/_authenticated/admin/payment-links")({
  component: PaymentLinksRedirect,
});
