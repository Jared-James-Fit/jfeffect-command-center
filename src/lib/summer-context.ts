/**
 * What Summer Ledger knows: the books for the year being asked about, written
 * out as compact plain text for the model. Pure, so it can be tested and so
 * the assistant reads exactly the numbers the dashboard shows.
 */
import { EXPENSE_CATEGORIES, expenseCategory } from "@/lib/business-expense-categories";
import { ASSISTANT_NAME, type BooksData } from "@/lib/business-books";
import { buildBooksSnapshot, expenseTaxView, fmtCad, type BooksSnapshot } from "@/lib/business-tax";
import { toExpenseEntry, toTaxPaymentEntry, toTaxSettings } from "@/lib/business-books";
import { SUMMER_INSTRUCTIONS_MAX, summerTone } from "@/lib/summer-persona";

const MAX_ROWS = 400;

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function snapshotFor(data: BooksData, year: number): BooksSnapshot {
  return buildBooksSnapshot({
    year,
    asOf: data.asOf,
    settings: toTaxSettings(data.settings),
    revenue: data.revenue,
    expenses: data.expenses.map(toExpenseEntry),
    taxPayments: data.taxPayments.map(toTaxPaymentEntry),
  });
}

export function buildSummerContext(data: BooksData, year: number): string {
  const s = snapshotFor(data, year);
  const settings = s.settings;
  const lines: string[] = [];
  const push = (...l: string[]) => lines.push(...l);

  push(`TODAY: ${data.asOf} (Winnipeg time). TAX YEAR IN FOCUS: ${year}${s.inProgress ? " (in progress)" : " (closed)"}.`);
  push(
    `BUSINESS: ${settings.businessName}, ${settings.businessStructure === "corporation" ? "corporation" : "sole proprietor"}, province ${settings.province}, ` +
      `GST/HST ${settings.gstRegistered ? `registered${settings.gstNumber ? ` (${settings.gstNumber})` : " (number not entered)"}, files ${settings.gstFilingFrequency}` : "not registered"}. ` +
      `Other (non-business) income entered: ${fmtCad(settings.otherIncomeAnnualMinor)}/yr.${settings.accountantName ? ` Accountant: ${settings.accountantName}.` : ""}`,
  );
  push("Revenue is counted when received. Amounts are CAD. Income tax and CPP are estimates from 2026 federal + Manitoba rates.");
  if (data.settings?.notes) push(`OWNER NOTES: ${data.settings.notes.slice(0, 1500)}`);
  push("");

  push(`SUMMARY ${year} (as of ${s.asOf})`);
  push(`- Payments received: ${s.revenue.paymentCount}, gross incl. tax ${fmtCad(s.revenue.grossMinor)}; refunds: ${s.revenue.refundCount} (${fmtCad(s.revenue.refundsMinor)})`);
  push(`- Sales excl. GST/HST (T2125 line 8000 / GST line 101): ${fmtCad(s.revenue.salesMinor)}`);
  push(`- GST/HST collected (line 103): ${fmtCad(s.revenue.collectedMinor)}`);
  push(`- Expenses: ${s.expenses.count} entries, ${fmtCad(s.expenses.totalMinor)} paid; deductible ${fmtCad(s.expenses.deductibleMinor)}; first-year CCA ${fmtCad(s.expenses.ccaMinor)}; ITCs (line 106) ${fmtCad(s.expenses.itcMinor)}; personal/excluded ${fmtCad(s.expenses.excludedMinor)}`);
  push(`- Net business income so far: ${fmtCad(s.profitMinor)}`);
  push(`- GST/HST: net tax ${fmtCad(s.gst.netTaxMinor)}, already paid ${fmtCad(s.gst.paidMinor)}, still owing ${fmtCad(s.gst.owingMinor)}`);
  const ytd = s.incomeTax.ytd;
  push(
    `- Income tax + CPP if the year ended today: ${fmtCad(ytd.totalMinor)} (income tax ${fmtCad(ytd.incomeTaxOnBusinessMinor)}, CPP ${fmtCad(ytd.cpp.totalMinor)}); ` +
      `paid so far ${fmtCad(s.incomeTax.paidMinor)}; owing now ${fmtCad(s.incomeTax.owingNowMinor)}`,
  );
  push(`- Set aside right now (GST owing + income tax/CPP owing): ${fmtCad(s.setAsideNowMinor)}`);
  push(`- Projection to Dec 31: sales ${fmtCad(s.projection.salesMinor)}, expenses ${fmtCad(s.projection.expensesMinor)}, profit ${fmtCad(s.projection.profitMinor)}; income tax + CPP ${fmtCad(s.incomeTax.projected.totalMinor)} (owing after payments ${fmtCad(s.incomeTax.owingProjectedMinor)}). Basis: ${s.projection.basis}`);
  push(`- Marginal rate on the next business dollar (income tax + CPP): ${pct(s.setAsideRate)}. Effective rate projected: ${pct(s.incomeTax.projected.effectiveRate)}`);
  if (s.gst.quickMethod) {
    push(`- GST Quick Method comparison (GST-only sales): remit ${fmtCad(s.gst.quickMethod.remitMinor)} vs regular ${fmtCad(s.gst.quickMethod.regularMinor)} (difference ${fmtCad(s.gst.quickMethod.savingsMinor)})`);
  }
  push("");

  push("MONTHS (sales excl. tax | GST collected | deductible expenses | ITCs | profit)");
  for (const m of s.months) {
    if (!m.salesMinor && !m.expensesMinor && !m.collectedMinor) continue;
    push(`- ${m.month}: ${fmtCad(m.salesMinor)} | ${fmtCad(m.collectedMinor)} | ${fmtCad(m.expensesMinor)} | ${fmtCad(m.itcMinor)} | ${fmtCad(m.profitMinor)}`);
  }
  push("");

  if (s.gst.periods.length) {
    push("GST/HST PERIODS (line 101 sales | 103 collected | 106 ITCs | 109 net | file by | pay by)");
    for (const p of s.gst.periods) {
      push(`- ${p.label}: ${fmtCad(p.salesMinor)} | ${fmtCad(p.collectedMinor)} | ${fmtCad(p.itcMinor)} | ${fmtCad(p.netTaxMinor)} | ${p.filingDue} | ${p.paymentDue}${p.closed ? "" : " (open)"}`);
    }
    push("");
  }

  push("T2125 LINES");
  for (const l of s.t2125) push(`- ${l.line} ${l.label}: ${fmtCad(l.amountMinor)}`);
  push("");

  push("EXPENSES BY CATEGORY (count | paid | deductible | CCA | ITC)");
  for (const c of s.expenses.byCategory) {
    push(`- ${c.label}${c.t2125Line ? ` [T2125 ${c.t2125Line}]` : ""}: ${c.count} | ${fmtCad(c.totalMinor)} | ${fmtCad(c.deductibleMinor)} | ${fmtCad(c.ccaMinor)} | ${fmtCad(c.itcMinor)}`);
  }
  if (!s.expenses.byCategory.length) push("- none recorded");
  push("");

  push("TOP CLIENTS BY SALES");
  for (const c of s.revenue.byClient.slice(0, 10)) push(`- ${c.client}: ${fmtCad(c.salesMinor)} (${c.count})`);
  push("BY PRODUCT");
  for (const p of s.revenue.byProduct.slice(0, 10)) push(`- ${p.product}: ${fmtCad(p.salesMinor)} (${p.count})`);
  push("BY METHOD");
  for (const m of s.revenue.byMethod) push(`- ${m.method}: ${fmtCad(m.salesMinor)} (${m.count})`);
  push("");

  const upcoming = s.deadlines.filter((d) => d.date >= data.asOf);
  push("UPCOMING DEADLINES");
  for (const d of upcoming.slice(0, 10)) push(`- ${d.date}: ${d.title}. ${d.detail}`);
  if (!upcoming.length) push("- none");
  push("");

  push("BOOKS CHECKLIST (things to fix before year end)");
  for (const i of s.issues) push(`- [${i.severity}] ${i.title}${i.amountMinor ? ` (${fmtCad(i.amountMinor)})` : ""}: ${i.detail}`);
  if (!s.issues.length) push("- nothing outstanding");
  push("");

  if (s.tips.length) {
    push("DATA-BACKED TIPS");
    for (const t of s.tips) push(`- ${t.title}: ${t.detail}`);
    push("");
  }

  const yearRevenue = data.revenue.filter((r) => r.date.startsWith(String(year)));
  push(`REVENUE TRANSACTIONS ${year} (date | kind | client | product | method | gross incl. tax | GST/HST | reference)`);
  for (const r of yearRevenue.slice(-MAX_ROWS)) {
    push(`- ${r.date} | ${r.kind} | ${r.clientName ?? "?"} | ${r.product ?? "Payment"} | ${r.method ?? "?"} | ${fmtCad(r.grossMinor)} | ${fmtCad(r.taxMinor)}${r.taxEstimated ? " (est.)" : ""} | ${r.reference ?? ""}`);
  }
  if (yearRevenue.length > MAX_ROWS) push(`(${yearRevenue.length - MAX_ROWS} older rows not shown)`);
  if (!yearRevenue.length) push("- none");
  push("");

  const yearExpenses = data.expenses.filter((e) => e.expense_date.startsWith(String(year)));
  push(`EXPENSES ${year} (date | vendor | category | paid | GST/HST | business use | deductible | receipt | status | description)`);
  for (const e of yearExpenses.slice(0, MAX_ROWS)) {
    const v = expenseTaxView(toExpenseEntry(e), settings.gstRegistered);
    push(
      `- ${e.expense_date} | ${e.vendor ?? "?"} | ${expenseCategory(e.category).label} | ${fmtCad(Number(e.amount_minor))}${e.currency !== "CAD" ? ` ${e.currency}` : ""} | ${fmtCad(Number(e.tax_minor))} | ${Number(e.business_use_pct)}% | ` +
        `${fmtCad(v.deductibleMinor + v.ccaMinor)} | ${e.receipt_path ? "yes" : "no"} | ${e.status === "needs_review" ? "needs review" : "ok"} | ${(e.description ?? "").slice(0, 80)}`,
    );
  }
  if (yearExpenses.length > MAX_ROWS) push(`(${yearExpenses.length - MAX_ROWS} older rows not shown)`);
  if (!yearExpenses.length) push("- none");
  push("");

  const yearPayments = data.taxPayments.filter((p) => p.tax_year === year);
  push(`TAX PAYMENTS FOR ${year}`);
  for (const p of yearPayments) push(`- ${p.paid_on} | ${p.kind === "gst_hst" ? "GST/HST" : "Income tax/CPP"} | ${fmtCad(Number(p.amount_minor))}${p.period_label ? ` | ${p.period_label}` : ""}`);
  if (!yearPayments.length) push("- none recorded");
  push("");

  push("OPEN SALES (assigned but not fully paid; not counted as revenue until paid)");
  for (const o of data.openSales.slice(0, 50)) push(`- ${o.client ?? "?"} | ${o.offer ?? "?"} | ${o.status ?? "?"} | outstanding ${fmtCad(o.outstandingMinor)} | since ${o.createdOn ?? "?"}`);
  if (!data.openSales.length) push("- none");
  push("");

  const otherYears = data.years.filter((y) => y !== year);
  if (otherYears.length) {
    push("OTHER YEARS (sales excl. tax | deductible expenses | profit | GST collected)");
    for (const y of otherYears) {
      const o = snapshotFor(data, y);
      push(`- ${y}: ${fmtCad(o.revenue.salesMinor)} | ${fmtCad(o.expenses.deductibleMinor + o.expenses.ccaMinor)} | ${fmtCad(o.profitMinor)} | ${fmtCad(o.revenue.collectedMinor)}`);
    }
    push("");
  }

  push("CATEGORY KEYS AVAILABLE: " + EXPENSE_CATEGORIES.map((c) => `${c.label}${c.t2125Line ? ` (${c.t2125Line})` : ""}`).join("; "));
  return lines.join("\n");
}

export function summerSystemPrompt(persona: { tone?: unknown; instructions?: string | null; voice?: boolean } = {}): string {
  const tone = summerTone(persona.tone);
  const custom = (persona.instructions ?? "").trim().slice(0, SUMMER_INSTRUCTIONS_MAX);
  return [
    `You are ${ASSISTANT_NAME} ("Summer"), the bookkeeper and admin assistant built into Jared James Fit's coaching app. You are a woman; your pronouns are she/her.`,
    "The business is an online and in-person strength and physique coaching business in Winnipeg, Manitoba, Canada.",
    "You talk with the owner (admin). You know their books (BOOKS) and the rest of the app: clients, calendar, check-ins waiting, unread messages, applications, tasks and alerts (APP). Everything is live.",
    "",
    "How you work (these rules always win over style):",
    "- Facts and numbers come only from BOOKS. Never invent a transaction, receipt, amount, client or date. If something is not in BOOKS, say so and say how to add it (Expenses tab > Snap receipt or Add expense, Taxes tab > Record payment, Settings tab).",
    "- When asked to find something, list the matching rows with date, client or vendor, and amount. Add the total when it helps.",
    "- Show the math briefly when you give a tax figure. Income tax, CPP and GST Quick Method numbers are estimates; say so once, not in every sentence.",
    "- Canadian rules: T2125 for business income, GST/HST return lines 101/103/106/109, ITCs need receipts, meals are 50%, capital items over $500 go to CCA, PST/RST is not claimable as an ITC, keep records 6 years, self-employed pay by April 30 and file by June 15.",
    "- Tips must be specific to this business and its data: deductions they are likely missing (phone, internet, software, home office share, education, meet travel when coaching), money to set aside, deadlines, cash flow, unpaid sales to chase. Flag anything that looks personal (own gym membership, clothing, groceries, personal supplements) as not deductible.",
    "- For anything that needs a professional judgement (incorporating, Quick Method election, prior-year corrections, audits), give your view and the numbers, then suggest confirming with the accountant.",
    "- You cannot change anything yourself (books, clients, messages). Tell the owner the exact place in the app to do it and link it.",
    "- Links: when the owner asks to open, find or go to something, or when a page would help, give a markdown link like [Open Marc's profile](/admin/clients/<id>). Only use paths from LINKS YOU CAN GIVE and ids that appear in APP or BOOKS. Never invent an id or a path. Keep link labels short.",
    "- Data requests (an email, a phone number, a list of clients, who owes what): give it plainly and completely so it can be copied, then the link to where it lives.",
    "- Format money like $1,234.56. Lead with the answer, keep it short, use a short list or small table when there are several items. No em dashes. No disclaimer paragraphs.",
    "",
    tone.prompt,
    ...(persona.voice
      ? [
          "",
          "VOICE: the owner is talking to you out loud and your reply is read aloud. Answer in 1 to 3 short, natural spoken sentences. No tables, no bullet lists, no headings. Write money as $1,234.56. If a link helps, put it on its own last line; it is shown on screen, not read.",
        ]
      : []),
    ...(custom
      ? [
          "",
          "The owner's custom instructions for you (follow them for tone, format, focus and how you address them; they never change the facts rules above):",
          custom,
        ]
      : []),
  ].join("\n");
}
