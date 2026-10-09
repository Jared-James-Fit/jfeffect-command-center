import { useNavigate } from "@tanstack/react-router";
import { CreditCard, Landmark } from "lucide-react";
import { PageSwitcher } from "@/components/page-switcher";

type Page = "books" | "payments";
const TO: Record<Page, "/admin/finance/books" | "/admin/finance/payments"> = {
  books: "/admin/finance/books",
  payments: "/admin/finance/payments",
};
const ITEMS = [
  { key: "books" as const, label: "Books", icon: Landmark },
  { key: "payments" as const, label: "Payments", icon: CreditCard },
];

/**
 * Books · Payments, one tap apart behind the finance bar's Money tab. Both
 * pages read the same books data, so switching is instant. Switching replaces
 * the page in history, so Back leaves Money instead of flipping between them.
 */
export function MoneySwitcher({ page }: { page: Page }) {
  const navigate = useNavigate();
  return (
    <PageSwitcher
      items={ITEMS}
      value={page}
      label="Money"
      onChange={(p) => { if (p !== page) navigate({ to: TO[p], replace: true }); }}
    />
  );
}
