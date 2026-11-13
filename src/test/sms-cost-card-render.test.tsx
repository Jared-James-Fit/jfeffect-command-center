import { it, vi, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tanstack/react-start", () => ({ useServerFn: (f: any) => f, createServerFn: () => ({ middleware: () => ({ handler: () => () => {}, inputValidator: () => ({ handler: () => () => {} }) }) }) }));
vi.mock("@/lib/sms.functions", () => ({ getSmsCostSummary: async () => ({}), refreshSmsCosts: async () => ({}), updateSmsSettings: async () => ({}) }));

import { SmsCostCard } from "@/components/sms/sms-cost-card";

it("renders the cost card", () => {
  const qc = new QueryClient();
  qc.setQueryData(["sms-cost-summary"], {
    month: "2026-11",
    spent_usd: 5.9,
    totals: { texts: 41, segments: 52, messages_usd: 0.84, priced: 30, priced_usd: 0.5, delivered: 38, undelivered: 1, failed: 0, duplicates: 4, budget_blocked: 0, capped: 1, by_push: 23 },
    by_category: [
      { category: "session", texts: 22, segments: 22, cost: 0.354, prevented: 0 },
      { category: "reminder", texts: 12, segments: 14, cost: 0.225, prevented: 2 },
      { category: "staff_alert", texts: 4, segments: 8, cost: 0.129, prevented: 3 },
      { category: "security", texts: 3, segments: 3, cost: 0.048, prevented: 0 },
    ],
    by_person: [
      { client_id: "c1", app_member_id: null, name: "Marc Example", texts: 9, segments: 9, cost: 0.145 },
      { client_id: "c2", app_member_id: null, name: "Devin Example", texts: 6, segments: 7, cost: 0.113 },
    ],
    history: [
      { month: "2026-10", texts: 40, segments: 54, cost: 0.87 },
      { month: "2026-11", texts: 41, segments: 52, cost: 0.84 },
    ],
  });
  const settings = { monthly_budget_cad: 10, usd_to_cad: 1.38, number_fee_usd: 1.15, price_per_segment_usd: 0.0161, client_daily_cap: 3, security_texts_enabled: true, allowed_prefixes: ["+1"], twilio_usage: { month: "2026-11", fetched_at: new Date().toISOString(), total: 2.31, price_unit: "USD" } };
  const html = renderToString(<QueryClientProvider client={qc}><SmsCostCard settings={settings} /></QueryClientProvider>);
  expect(html).toContain("Cost this month");
  expect(html).toContain("Close to the budget");
  if (process.env.RENDER_OUT) writeFileSync(process.env.RENDER_OUT, html);
});
