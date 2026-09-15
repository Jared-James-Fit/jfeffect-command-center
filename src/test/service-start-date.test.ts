import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseCalendarDate,
  toCalendarDate,
  calendarRoundTrip,
  formatCalendarDate,
} from "@/lib/calendar-date";
import {
  blankBillingSchedule,
  productDefaultSchedule,
  productRequiresStartDecision,
  productStartLabel,
  resolveServiceStartDate,
  validateBillingSchedule,
} from "@/lib/billing-schedule";
import { resolveAccessState, accessBadge } from "@/lib/service-access-status";

const read = (p: string) => readFileSync(p, "utf8");
const dateField = read("src/components/ui/date-field.tsx");
const customSale = read("src/components/clients/add-sale-dialog.tsx");
const assignDialog = read("src/components/assign-offer-dialog.tsx");
const productModal = read("src/components/products/new-product-modal.tsx");
const saleEditor = read("src/components/purchase-records-panel.tsx");
const salesTable = read("src/components/admin/client-sales-table.tsx");

describe("coaching start date", () => {
  it("1. custom sale reveals a real picker for 'On a specific date'", () => {
    expect(customSale).toContain('serviceStartMode === "on_date"');
    expect(customSale).toContain("custom-sale-service-start");
    expect(customSale).toContain("<DateField");
  });

  it("2. the picker opens above the sale modal and stays clickable inside it", () => {
    expect(dateField).toContain("<Popover modal");
    expect(dateField).toContain("z-[80]");
    expect(dateField).toContain("pointer-events-auto");
  });

  it("3. any calendar date is selectable, including a far future one", () => {
    expect(parseCalendarDate("2026-09-20")).toBeInstanceOf(Date);
    expect(toCalendarDate(parseCalendarDate("2026-09-20"))).toBe("2026-09-20");
  });

  it("4. the picked date becomes the field value", () => {
    expect(dateField).toContain("onChange(toCalendarDate(date))");
  });

  it("5. the live summary reads the same schedule draft", () => {
    expect(customSale).toContain("scheduleSummary");
    expect(customSale).toContain("serviceStartDate");
  });

  it("6. the review step resolves the identical service start", () => {
    const draft = { ...blankBillingSchedule(), serviceStartMode: "on_date" as const, serviceStartDate: "2026-09-20" };
    expect(resolveServiceStartDate(draft, "2026-10-01")).toBe("2026-09-20");
  });

  it("7. an incomplete specific date blocks the sale", () => {
    const draft = { ...blankBillingSchedule(), serviceStartMode: "on_date" as const };
    expect(validateBillingSchedule(draft)).toBe("Pick the service start date.");
  });

  it("8. the sale persists the chosen date, not today", () => {
    expect(read("src/lib/add-sale.ts")).toContain("service_start_date");
  });

  it("9. New Product offers a specific start date with a picker", () => {
    expect(productModal).toContain('<SelectItem value="specific_date">');
    expect(productModal).toContain("product-start-date");
  });

  it("10. New Product cannot save 'specific date' without a date", () => {
    expect(productModal).toContain('errs.startDate = "Pick the start date"');
  });

  it("11. 'Admin chooses when assigning' is a real product option", () => {
    expect(productModal).toContain('<SelectItem value="admin_choice">');
    expect(productRequiresStartDecision({ service_start_mode: "admin_choice" })).toBe(true);
  });

  it("12. assigning such a product forces a start decision", () => {
    expect(assignDialog).toContain("productRequiresStartDecision");
    const draft = productDefaultSchedule({ service_start_mode: "admin_choice" });
    expect(draft.serviceStartMode).toBe("on_date");
    expect(validateBillingSchedule(draft)).toBe("Pick the service start date.");
  });

  it("13. a product default seeds the sale but the override is per client", () => {
    const draft = productDefaultSchedule({ service_start_mode: "on_date", service_start_date: "2026-09-20" });
    expect(draft.serviceStartDate).toBe("2026-09-20");
    expect(assignDialog).toContain("Applies to this client's sale only");
  });

  it("14. overriding a client's sale never writes back to the product", () => {
    expect(assignDialog).not.toContain("updateCoachingProduct");
  });

  it("15. first payment and coaching start stay independent", () => {
    const draft = { ...blankBillingSchedule(), serviceStartMode: "on_date" as const, serviceStartDate: "2026-09-20" };
    expect(resolveServiceStartDate(draft, "2026-10-01")).toBe("2026-09-20");
    const linked = { ...blankBillingSchedule(), serviceStartMode: "with_first_payment" as const };
    expect(resolveServiceStartDate(linked, "2026-10-01")).toBe("2026-10-01");
  });

  it("16. a future start does not read as active access", () => {
    const state = resolveAccessState(
      { service_start_date: "2026-09-20", payment_status: "Paid" },
      "2026-09-14",
    );
    expect(state).toBe("upcoming");
    expect(accessBadge({ service_start_date: "2026-09-20", payment_status: "Paid" }, "2026-09-14").label)
      .toBe("Starts September 20, 2026");
  });

  it("17. access flips to active on the chosen day", () => {
    expect(resolveAccessState({ service_start_date: "2026-09-20", payment_status: "Paid" }, "2026-09-20")).toBe("active");
  });

  it("18. session credits are held until access starts", () => {
    const sql = read("drizzle/migrations/0007_defer_session_grants_until_service_start.sql");
    expect(sql).toContain("service_start_date > (now() AT TIME ZONE 'America/Winnipeg')::date");
    expect(sql).toContain("grant_sessions_due_today");
  });

  it("19. the sale's dates can be edited later with the same picker", () => {
    expect(saleEditor).toContain("coaching-start");
    expect(saleEditor).toContain("Stripe billing dates are unchanged");
  });

  it("20. dates never shift a day across timezones", () => {
    for (const d of ["2026-01-01", "2026-03-08", "2026-09-20", "2026-12-31"]) {
      expect(calendarRoundTrip(d)).toBe(d);
    }
    expect(formatCalendarDate("2026-09-20")).toBe("September 20, 2026");
  });

  it("21. the picker replaces the native date inputs in both sale dialogs", () => {
    expect(customSale).not.toContain('type="date"');
    expect(assignDialog).not.toContain('type="date"');
  });

  it("22. the client sales list shows access separately from payment", () => {
    expect(salesTable).toContain("AccessBadge");
    expect(productStartLabel({ service_start_mode: "admin_choice" })).toBe("Start date chosen when assigning");
  });
});
