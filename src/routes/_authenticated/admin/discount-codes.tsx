import { createFileRoute } from "@tanstack/react-router";
import { DiscountCodesPage } from "@/route-pages/_authenticated/admin/discount-codes";

export const Route = createFileRoute("/_authenticated/admin/discount-codes")({
  component: () => <DiscountCodesPage />,
});
