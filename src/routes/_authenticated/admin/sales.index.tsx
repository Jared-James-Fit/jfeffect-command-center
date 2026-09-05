import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { PageHeader } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { SalesPageEditor } from "@/components/admin/sales-page-editor";
import { PaymentLinksPage } from "./payment-links";
import { DiscountCodesPage } from "./discount-codes";
import { AdminTransactionsPage } from "./transactions";
import { BillingSourcesPage } from "./billing-sources";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Package, Receipt, Ticket, Settings2, LayoutTemplate } from "lucide-react";

/**
 * Canonical Sales information architecture.
 *
 * One navigation layer only: Products / Transactions / Discount Codes /
 * Settings. Pipeline moved to CRM, Promotions folded into Discount Codes,
 * Overview folded into Transactions. Sales Pages stays reachable by deep
 * link (media managers) but is no longer a primary Sales section.
 */
type SectionKey = "products" | "transactions" | "discount-codes" | "settings" | "sales-pages";

const SECTIONS: {
  value: SectionKey;
  label: string;
  icon: typeof Package;
  roles: Array<"admin" | "coach" | "media_manager">;
  primary: boolean;
}[] = [
  { value: "products", label: "Products", icon: Package, roles: ["admin"], primary: true },
  { value: "transactions", label: "Transactions", icon: Receipt, roles: ["admin"], primary: true },
  { value: "discount-codes", label: "Discount Codes", icon: Ticket, roles: ["admin"], primary: true },
  { value: "settings", label: "Settings", icon: Settings2, roles: ["admin"], primary: true },
  { value: "sales-pages", label: "Sales Pages", icon: LayoutTemplate, roles: ["admin", "media_manager"], primary: false },
];

const LAST_TAB_KEY = "jf-admin-sales-last-tab";

/** Legacy `?tab=` / `?sub=` values → canonical section. */
function normalizeSection(tab: unknown, sub: unknown): SectionKey | "redirect:crm" | null {
  const t = typeof tab === "string" ? tab : "";
  const s = typeof sub === "string" ? sub : "";
  if (SECTIONS.some((x) => x.value === t)) return t as SectionKey;
  if (t === "pipeline") return "redirect:crm";
  if (t === "promotions") return "discount-codes";
  if (t === "sales-pages") return "sales-pages";
  if (t === "products-payments") {
    if (s === "transactions" || s === "payments" || s === "purchases" || s === "overview") return "transactions";
    if (s === "discount-codes") return "discount-codes";
    if (s === "settings") return "settings";
    return "products";
  }
  return null;
}

type Search = { tab: SectionKey | "pipeline"; sub?: string };

export const Route = createFileRoute("/_authenticated/admin/sales/")({
  validateSearch: (raw: Record<string, unknown>): Search => {
    const sub = typeof raw?.sub === "string" ? (raw.sub as string) : undefined;
    const resolved = normalizeSection(raw?.tab, sub);
    if (resolved === "redirect:crm") return { tab: "pipeline", sub };
    if (resolved) return { tab: resolved, sub };
    if (typeof raw?.tab === "undefined" && typeof window !== "undefined") {
      try {
        const stored = normalizeSection(window.localStorage.getItem(LAST_TAB_KEY), undefined);
        if (stored && stored !== "redirect:crm") return { tab: stored, sub };
      } catch {}
    }
    return { tab: "products", sub };
  },
  component: SalesWorkspace,
});

function SalesWorkspace() {
  const { tab, sub } = Route.useSearch();
  const navigate = useNavigate();
  const { role } = useAuth();

  // Pipeline now lives in CRM — bounce legacy deep links there.
  useEffect(() => {
    if (tab === "pipeline") navigate({ to: "/admin/crm", replace: true });
  }, [tab, navigate]);

  const visible = useMemo(() => {
    const r = (role ?? "admin") as "admin" | "coach" | "media_manager";
    return SECTIONS.filter((s) => s.roles.includes(r));
  }, [role]);

  const primary = visible.filter((s) => s.primary);
  const active: SectionKey =
    visible.some((s) => s.value === tab) ? (tab as SectionKey) : (visible[0]?.value ?? "products");

  useEffect(() => {
    try { window.localStorage.setItem(LAST_TAB_KEY, active); } catch {}
  }, [active]);

  const setSection = (next: SectionKey) => {
    navigate({ to: "/admin/sales", search: { tab: next } as any, replace: false });
  };

  const navItems = primary.length ? primary : visible;
  const activeLabel = visible.find((s) => s.value === active)?.label ?? "Products";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Sales"
        subtitle="Products, transactions, discount codes and checkout settings."
      />

      {/* Mobile / tablet portrait: single section picker, full-width workspace */}
      <div className="border-b border-border bg-background/60 px-4 py-2 lg:hidden">
        <Select value={active} onValueChange={(v) => setSection(v as SectionKey)}>
          <SelectTrigger className="h-10 w-full text-sm font-semibold" aria-label="Sales section">
            <SelectValue>{activeLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {visible.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Desktop / tablet landscape: local left rail + independent workspace */}
      <div className="flex min-h-0 flex-1 lg:overflow-hidden">
        <nav
          data-sales-rail
          className="hidden w-48 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border bg-card/40 p-2 lg:flex xl:w-56"
          aria-label="Sales sections"
        >
          <div className="px-2 pb-1 pt-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            Sales
          </div>
          {navItems.map((s) => {
            const Icon = s.icon;
            const isActive = s.value === active;
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => setSection(s.value)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{s.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1 lg:overflow-y-auto">
          {active === "products" && <PaymentLinksPage embedded />}
          {active === "transactions" && <AdminTransactionsPage embedded />}
          {active === "discount-codes" && <DiscountCodesPage embedded />}
          {active === "settings" && <BillingSourcesPage />}
          {active === "sales-pages" && (
            <div className="p-4 md:p-6">
              <SalesPageEditor pageKey={sub === "membership" ? "join" : "coaching"} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
