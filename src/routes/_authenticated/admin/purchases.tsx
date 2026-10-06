import { createFileRoute } from "@tanstack/react-router";
import { PurchasesRedirect } from "@/route-pages/_authenticated/admin/purchases";

export const Route = createFileRoute("/_authenticated/admin/purchases")({ component: PurchasesRedirect });
