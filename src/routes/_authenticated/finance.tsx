import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { BookOpenCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { AppShell, type NavItem } from "@/components/app-shell";
import { FullPageLoader } from "@/components/full-page-loader";
import { StaffMfaGate } from "@/components/staff-mfa-gate";
import { TaxesBooksPage } from "@/components/admin/books/taxes-books-page";

/**
 * The finance area: Taxes & Books for the staff-only finance login. Finance
 * never reaches /admin, /portal or /m; the owner keeps the books under Sales.
 */
const FINANCE_NAV: NavItem[] = [{ to: "/finance", label: "Books", icon: BookOpenCheck }];

function FinanceLayout() {
  const { role, loading } = useAuth();
  const navigate = useNavigate();
  const allowed = role === "finance";

  useEffect(() => {
    if (loading || !role || allowed) return;
    navigate({ to: role === "admin" ? "/admin" : "/", replace: true });
  }, [role, loading, allowed, navigate]);

  if (loading || !role) return <FullPageLoader />;
  if (!allowed) return <FullPageLoader label="Redirecting…" />;

  return (
    <StaffMfaGate>
      <AppShell items={FINANCE_NAV} bottomItems={FINANCE_NAV} title="Finance">
        <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
          <TaxesBooksPage mode="finance" />
        </div>
      </AppShell>
    </StaffMfaGate>
  );
}

export const Route = createFileRoute("/_authenticated/finance")({
  head: () => ({ meta: [{ title: "Finance — JF Effect" }] }),
  component: FinanceLayout,
});
