import { createFileRoute } from "@tanstack/react-router";
import { PromoCodesRedirect } from "@/route-pages/_authenticated/admin/promo-codes";

export const Route = createFileRoute("/_authenticated/admin/promo-codes")({
  component: PromoCodesRedirect,
});
