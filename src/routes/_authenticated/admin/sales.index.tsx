import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { PageHeader } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { SalesPageEditor } from "@/components/admin/sales-page-editor";
import { CrmDashboard } from "./crm.index";
import { PaymentLinksPage } from "./payment-links";
import { PaymentsPage } from "./payments";
import { PurchasesPage } from "./purchases";
import { PromoCodesPage } from "./promo-codes";

type TabKey = "pipeline" | "products-payments" | "sales-pages" | "promotions";

const ALL_TABS: { value: TabKey; label: string; roles: Array<"admin" | "coach" | "media_manager"> }[] = [
  { value: "pipeline", label: "Pipeline", roles: ["admin"] },
  { value: "products-payments", label: "Products & Payments", roles: ["admin"] },
  { value: "sales-pages", label: "Sales Pages", roles: ["admin", "media_manager"] },
  { value: "promotions", label: "Promotions", roles: ["admin"] },
];

const LAST_TAB_KEY = "jf-admin-sales-last-tab";

function isTab(v: unknown): v is TabKey {
  return typeof v === "string" && ALL_TABS.some((t) => t.value === v);
}

type Search = { tab: TabKey; sub?: string };

export const Route = createFileRoute("/_authenticated/admin/sales/")({
  validateSearch: (raw: Record<string, unknown>): Search => {
    const t = raw?.tab;
    const sub = typeof raw?.sub === "string" ? (raw.sub as string) : undefined;
    if (isTab(t)) return { tab: t, sub };
    if (typeof t === "undefined" && typeof window !== "undefined") {
      try {
        const stored = window.localStorage.getItem(LAST_TAB_KEY);
        if (isTab(stored)) return { tab: stored, sub };
      } catch {}
    }
    return { tab: "pipeline", sub };
  },
  component: SalesWorkspace,
});

function SalesWorkspace() {
  const { tab, sub } = Route.useSearch();
  const navigate = useNavigate();
  const { role } = useAuth();

  const visibleTabs = useMemo(() => {
    const r = (role ?? "admin") as "admin" | "coach" | "media_manager";
    return ALL_TABS.filter((t) => t.roles.includes(r));
  }, [role]);

  const activeTab: TabKey = visibleTabs.some((t) => t.value === tab) ? tab : (visibleTabs[0]?.value ?? "pipeline");

  useMemo(() => {
    try { window.localStorage.setItem(LAST_TAB_KEY, activeTab); } catch {}
  }, [activeTab]);

  const setTab = (next: TabKey) => {
    navigate({ to: "/admin/sales", search: { tab: next } as any, replace: false });
  };
  const setSub = (nextSub: string) => {
    navigate({ to: "/admin/sales", search: { tab: activeTab, sub: nextSub } as any, replace: false });
  };

  return (
    <>
      <PageHeader
        title="Sales"
        subtitle="Manage your pipeline, offers, checkout, promotions, and sales assets."
      />
      <div className="border-b border-border bg-background/50">
        <div className="-mb-px flex gap-1 overflow-x-auto px-2 md:px-4">
          {visibleTabs.map((t) => {
            const active = t.value === activeTab;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setTab(t.value)}
                className={cn(
                  "shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-semibold transition-colors",
                  active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
                aria-current={active ? "page" : undefined}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        {activeTab === "pipeline" && <PipelinePanel />}
        {activeTab === "products-payments" && <ProductsPaymentsPanel sub={sub} onSub={setSub} />}
        {activeTab === "sales-pages" && <SalesPagesPanel sub={sub} onSub={setSub} />}
        {activeTab === "promotions" && <PromoCodesPage embedded />}
      </div>
    </>
  );
}

function PipelinePanel() {
  return (
    <div className="p-4 md:p-6">
      <CrmDashboard embedded />
    </div>
  );
}

const PP_SUBS = [
  { value: "products", label: "Products" },
  { value: "payments", label: "Payments" },
  { value: "purchases", label: "Purchases" },
] as const;

function ProductsPaymentsPanel({ sub, onSub }: { sub?: string; onSub: (s: string) => void }) {
  const active = (PP_SUBS.find((s) => s.value === sub)?.value) ?? "products";
  return (
    <div>
      <SubTabs items={PP_SUBS as any} active={active} onChange={onSub} />
      {active === "products" && <PaymentLinksPage embedded />}
      {active === "payments" && <PaymentsPage embedded />}
      {active === "purchases" && <PurchasesPage embedded />}
    </div>
  );
}

const SP_SUBS = [
  { value: "coaching", label: "Coaching" },
  { value: "membership", label: "Membership" },
] as const;

function SalesPagesPanel({ sub, onSub }: { sub?: string; onSub: (s: string) => void }) {
  const active = (SP_SUBS.find((s) => s.value === sub)?.value) ?? "coaching";
  return (
    <div>
      <SubTabs items={SP_SUBS as any} active={active} onChange={onSub} />
      <div className="p-4 md:p-6">
        <SalesPageEditor pageKey={active === "membership" ? "join" : "coaching"} />
      </div>
    </div>
  );
}

function SubTabs({
  items, active, onChange,
}: {
  items: ReadonlyArray<{ value: string; label: string }>;
  active: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="border-b border-border bg-muted/20">
      <div className="-mb-px flex gap-1 overflow-x-auto px-2 md:px-4">
        {items.map((t) => {
          const isActive = t.value === active;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => onChange(t.value)}
              className={cn(
                "shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-colors",
                isActive ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}