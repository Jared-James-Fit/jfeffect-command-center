import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useScrollFade } from "@/hooks/use-scroll-fade";
import { useEffect, useMemo } from "react";
import { PageHeader } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { SalesPageEditor } from "@/components/admin/sales-page-editor";
import { PaymentLinksPage } from "@/route-pages/_authenticated/admin/payment-links";
import { DiscountCodesPage } from "@/route-pages/_authenticated/admin/discount-codes";
import { AdminTransactionsPage } from "@/route-pages/_authenticated/admin/transactions";
import { BillingSourcesPage } from "@/route-pages/_authenticated/admin/billing-sources";
import { MoneyWorkspace } from "@/components/admin/money/money-workspace";
import type { MoneyView } from "@/components/admin/money/money-context";
import type { CompareMode } from "@/lib/books/period";
import { useIsBusinessOwner } from "@/lib/business-owner";
import { lazyWithRetry } from "@/lib/lazy-chunk";

const CoachingSalesToolkit = lazyWithRetry(() => import("@/components/admin/coaching-sales/coaching-sales-toolkit"));
import {
  Activity, BarChart3, FileText, Landmark, LayoutTemplate, ListOrdered, Package, Settings2, Tags, Ticket,
} from "lucide-react";

/**
 * Sales: the business's money first (Overview, Transactions, Taxes, Reports:
 * the books, private to the business owner and the finance login), then what
 * it sells (Coaching packages: what the site and pricing cards say; Products,
 * Discount codes, Stripe activity, Settings). One menu: a rail on a computer,
 * a row of words on a phone.
 */
type SectionKey =
  | MoneyView
  | "coaching"
  | "products"
  | "discount-codes"
  | "stripe"
  | "settings"
  | "sales-pages";

const MONEY_KEYS: MoneyView[] = ["overview", "transactions", "taxes", "reports"];

const SECTIONS: {
  value: SectionKey;
  label: string;
  icon: typeof Package;
  roles: Array<"admin" | "coach" | "media_manager">;
  /** The books: the business owner's (and the finance login's). */
  books?: boolean;
  group: "money" | "selling" | "hidden";
}[] = [
  { value: "overview", label: "Overview", icon: BarChart3, roles: ["admin"], books: true, group: "money" },
  { value: "transactions", label: "Transactions", icon: ListOrdered, roles: ["admin"], books: true, group: "money" },
  { value: "taxes", label: "Taxes", icon: Landmark, roles: ["admin"], books: true, group: "money" },
  { value: "reports", label: "Reports", icon: FileText, roles: ["admin"], books: true, group: "money" },
  { value: "coaching", label: "Coaching packages", icon: Tags, roles: ["admin"], group: "selling" },
  { value: "products", label: "Products", icon: Package, roles: ["admin"], group: "selling" },
  { value: "discount-codes", label: "Discount codes", icon: Ticket, roles: ["admin"], group: "selling" },
  { value: "stripe", label: "Stripe activity", icon: Activity, roles: ["admin"], group: "selling" },
  { value: "settings", label: "Settings", icon: Settings2, roles: ["admin"], group: "selling" },
  { value: "sales-pages", label: "Sales pages", icon: LayoutTemplate, roles: ["admin", "media_manager"], group: "hidden" },
];

const LAST_TAB_KEY = "jf-admin-sales-last-tab";

/** Old `?tab=` / `?sub=` values → today's sections. */
function normalizeSection(tab: unknown, sub: unknown): SectionKey | "redirect:crm" | null {
  const t = typeof tab === "string" ? tab : "";
  const s = typeof sub === "string" ? sub : "";
  if (SECTIONS.some((x) => x.value === t)) return t as SectionKey;
  if (t === "pipeline") return "redirect:crm";
  if (t === "promotions") return "discount-codes";
  if (t === "books") return "overview";
  if (t === "tax") return "taxes";
  if (t === "packages" || t === "pricing") return "coaching";
  if (t === "products-payments") {
    if (s === "overview") return "overview";
    if (s === "transactions" || s === "payments" || s === "purchases") return "transactions";
    if (s === "discount-codes") return "discount-codes";
    if (s === "settings") return "settings";
    return "products";
  }
  return null;
}

type Search = { tab: SectionKey | "pipeline"; sub?: string; p?: string; cmp?: CompareMode };

const COMPARES: CompareMode[] = ["previous", "last_year", "none"];

export const Route = createFileRoute("/_authenticated/admin/sales/")({
  validateSearch: (raw: Record<string, unknown>): Search => {
    const sub = typeof raw?.sub === "string" ? (raw.sub as string) : undefined;
    const p = typeof raw?.p === "string" ? (raw.p as string) : undefined;
    const cmp = COMPARES.includes(raw?.cmp as CompareMode) ? (raw.cmp as CompareMode) : undefined;
    const resolved = normalizeSection(raw?.tab, sub);
    if (resolved === "redirect:crm") return { tab: "pipeline", sub };
    if (resolved) return { tab: resolved, sub, p, cmp };
    if (typeof raw?.tab === "undefined" && typeof window !== "undefined") {
      try {
        const stored = normalizeSection(window.localStorage.getItem(LAST_TAB_KEY), undefined);
        if (stored && stored !== "redirect:crm") return { tab: stored, sub, p, cmp };
      } catch {}
    }
    return { tab: "overview", sub, p, cmp };
  },
  component: SalesWorkspace,
});

function SalesWorkspace() {
  const { tab, sub, p, cmp } = Route.useSearch();
  const navigate = useNavigate();
  const { role, viewOnly } = useAuth();

  // Pipeline now lives in CRM: bounce old deep links there.
  useEffect(() => {
    if (tab === "pipeline") navigate({ to: "/admin/crm", replace: true });
  }, [tab, navigate]);

  const isOwner = useIsBusinessOwner();
  const seesBooks = isOwner === true || viewOnly;
  const visible = useMemo(() => {
    const r = (role ?? "admin") as "admin" | "coach" | "media_manager";
    return SECTIONS.filter((s) => s.roles.includes(r) && (!s.books || seesBooks));
  }, [role, seesBooks]);

  // Without the books, Transactions is the Stripe account's activity (as it was).
  const asked = (tab === "transactions" && isOwner === false && !viewOnly ? "stripe" : tab) as SectionKey;
  const active: SectionKey = visible.some((s) => s.value === asked) ? asked : (visible[0]?.value ?? "products");

  useEffect(() => {
    try { window.localStorage.setItem(LAST_TAB_KEY, active); } catch {}
  }, [active]);

  const setSection = (next: SectionKey) => {
    navigate({ to: "/admin/sales", search: (s: any) => ({ tab: next, p: s.p, cmp: s.cmp }) as any, replace: false });
  };

  const navItems = visible.filter((s) => s.group !== "hidden");
  const isMoney = (MONEY_KEYS as string[]).includes(active);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Sales" />

      {/* Phone / tablet portrait: one row of words, the one you're on underlined and kept in view. */}
      <SectionRow items={navItems} active={active} onPick={setSection} />

      <div className="flex min-h-0 flex-1 lg:overflow-hidden">
        <nav
          data-sales-rail
          className="hidden w-48 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-2 lg:flex xl:w-56"
          aria-label="Sales sections"
        >
          {(["money", "selling"] as const).map((g) => {
            const items = navItems.filter((s) => s.group === g);
            if (!items.length) return null;
            return (
              <div key={g} className="mb-2">
                <div className="px-2.5 pb-1 pt-2 text-[12px] font-medium text-muted-foreground">{g === "money" ? "Money" : "Selling"}</div>
                {items.map((s) => {
                  const Icon = s.icon;
                  const on = s.value === active;
                  return (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setSection(s.value)}
                      aria-current={on ? "page" : undefined}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[14px] transition-colors",
                        on ? "bg-secondary font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{s.label}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1 lg:overflow-y-auto">
          {isMoney && (
            <MoneyWorkspace
              view={active as MoneyView}
              periodCode={p}
              compare={cmp ?? "previous"}
              mode={viewOnly ? "finance" : "owner"}
              onState={(patch) =>
                navigate({
                  to: "/admin/sales",
                  search: (s: any) => ({
                    tab: patch.view ?? s.tab,
                    p: patch.p ?? s.p,
                    cmp: patch.cmp ?? s.cmp,
                  }) as any,
                  // A new period replaces the page in history; a new view is a step Back can undo.
                  replace: !patch.view,
                })
              }
            />
          )}
          {active === "coaching" && <CoachingSalesToolkit />}
          {active === "products" && <PaymentLinksPage embedded />}
          {active === "stripe" && <AdminTransactionsPage embedded />}
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

function SectionRow({ items, active, onPick }: { items: typeof SECTIONS; active: SectionKey; onPick: (k: SectionKey) => void }) {
  // A word cut at the screen's edge fades out, so it reads as "more to swipe to".
  const { ref: rowRef, style: fade } = useScrollFade<HTMLDivElement>([items.length]);
  useEffect(() => {
    const row = rowRef.current;
    const el = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !el || row.scrollWidth <= row.clientWidth) return;
    row.scrollTo({ left: Math.max(0, el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2), behavior: "smooth" });
  }, [active]);
  return (
    <nav aria-label="Sales sections" className="border-b border-border px-2 lg:hidden" data-sales-row>
      <div ref={rowRef} style={fade} className="-mb-px flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((s, i) => {
          const on = s.value === active;
          const groupStart = i > 0 && items[i - 1].group !== s.group;
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => onPick(s.value)}
              aria-current={on ? "page" : undefined}
              className={cn(
                "relative flex h-11 shrink-0 items-center whitespace-nowrap px-3 text-[15px]",
                on ? "font-semibold text-foreground" : "text-muted-foreground",
                groupStart && "ml-2 border-l border-border pl-5",
              )}
            >
              {s.label}
              <span aria-hidden className={cn("absolute bottom-0 h-0.5 rounded-full", groupStart ? "left-5 right-3" : "inset-x-3", on ? "bg-foreground" : "bg-transparent")} />
            </button>
          );
        })}
      </div>
    </nav>
  );
}
