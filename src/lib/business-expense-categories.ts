/**
 * Expense categories for Taxes & Books, mapped to the CRA T2125 (Statement of
 * Business or Professional Activities) lines an accountant files them under.
 *
 * - deductiblePct / itcPct: share of the business-use amount that is deductible
 *   and the share of GST/HST paid that can be claimed back (meals are 50/50).
 * - capital: not expensed in one year. The estimate claims first-year CCA at
 *   the class rate (the half-year rule is suspended for property available for
 *   use 2024-2027); later years need the accountant's UCC schedule.
 * - excluded: kept in the books for the record but never deducted.
 */

export type ExpenseCategoryKind = "expense" | "capital" | "excluded";

export type ExpenseCategory = {
  key: string;
  label: string;
  t2125Line: string | null;
  t2125Label: string | null;
  kind: ExpenseCategoryKind;
  deductiblePct: number;
  itcPct: number;
  ccaRate?: number;
  ccaClass?: string;
  /** Short examples; also fed to the receipt reader so it picks consistently. */
  examples: string;
};

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  { key: "advertising", label: "Advertising & marketing", t2125Line: "8521", t2125Label: "Advertising", kind: "expense", deductiblePct: 1, itcPct: 1, examples: "Meta/Instagram ads, Google ads, promo printing, sponsored posts" },
  { key: "meals", label: "Meals & entertainment", t2125Line: "8523", t2125Label: "Meals and entertainment", kind: "expense", deductiblePct: 0.5, itcPct: 0.5, examples: "Client or business meals, coffee meetings (50% deductible)" },
  { key: "insurance", label: "Insurance", t2125Line: "8690", t2125Label: "Insurance", kind: "expense", deductiblePct: 1, itcPct: 1, examples: "Liability insurance, professional insurance" },
  { key: "bank_fees", label: "Bank & payment processing fees", t2125Line: "8710", t2125Label: "Interest and bank charges", kind: "expense", deductiblePct: 1, itcPct: 1, examples: "Stripe fees, bank account fees, e-transfer fees, business loan interest" },
  { key: "licences_memberships", label: "Licences, memberships & dues", t2125Line: "8760", t2125Label: "Business taxes, licences and memberships", kind: "expense", deductiblePct: 1, itcPct: 1, examples: "Business licence, federation membership, professional association dues" },
  { key: "office", label: "Office expenses", t2125Line: "8810", t2125Label: "Office expenses", kind: "expense", deductiblePct: 1, itcPct: 1, examples: "Postage, small office items, printer ink" },
  { key: "software", label: "Software & subscriptions", t2125Line: "8810", t2125Label: "Office expenses", kind: "expense", deductiblePct: 1, itcPct: 1, examples: "Apps, website hosting, domain, Canva, Google Workspace, music licences" },
  { key: "supplies", label: "Supplies & small equipment (under $500)", t2125Line: "8811", t2125Label: "Office stationery and supplies", kind: "expense", deductiblePct: 1, itcPct: 1, examples: "Bands, chalk, straps, tape, small tools, filming accessories" },
  { key: "professional_fees", label: "Accounting & legal", t2125Line: "8860", t2125Label: "Professional fees", kind: "expense", deductiblePct: 1, itcPct: 1, examples: "Accountant, bookkeeper, lawyer" },
  { key: "contractors", label: "Contractors & subcontracts", t2125Line: "8360", t2125Label: "Subcontracts", kind: "expense", deductiblePct: 1, itcPct: 1, examples: "Assistant coaches, editors, designers, VAs paid as contractors" },
  { key: "rent", label: "Rent (gym, studio, office)", t2125Line: "8910", t2125Label: "Rent", kind: "expense", deductiblePct: 1, itcPct: 1, examples: "Gym floor rental, studio rent, coaching space" },
  { key: "repairs", label: "Repairs & maintenance", t2125Line: "8960", t2125Label: "Repairs and maintenance", kind: "expense", deductiblePct: 1, itcPct: 1, examples: "Equipment repair, servicing" },
  { key: "wages", label: "Salaries & wages", t2125Line: "9060", t2125Label: "Salaries, wages and benefits", kind: "expense", deductiblePct: 1, itcPct: 0, examples: "Payroll to employees (not contractors)" },
  { key: "travel", label: "Travel", t2125Line: "9200", t2125Label: "Travel expenses", kind: "expense", deductiblePct: 1, itcPct: 1, examples: "Flights, hotels, taxis for meets, seminars, business trips" },
  { key: "phone_internet", label: "Phone & internet", t2125Line: "9220", t2125Label: "Telephone and utilities", kind: "expense", deductiblePct: 1, itcPct: 1, examples: "Cell phone plan, home internet (business-use share)" },
  { key: "vehicle", label: "Vehicle", t2125Line: "9281", t2125Label: "Motor vehicle expenses", kind: "expense", deductiblePct: 1, itcPct: 1, examples: "Fuel, parking, car insurance, repairs (business-use share)" },
  { key: "home_office", label: "Business-use-of-home", t2125Line: "9945", t2125Label: "Business-use-of-home expenses", kind: "expense", deductiblePct: 1, itcPct: 1, examples: "Share of rent, heat, hydro for a dedicated home workspace" },
  { key: "education", label: "Courses & certifications", t2125Line: "9270", t2125Label: "Other expenses", kind: "expense", deductiblePct: 1, itcPct: 1, examples: "Coaching certifications, seminars, courses, books for the business" },
  { key: "competition", label: "Meets & competition fees", t2125Line: "9270", t2125Label: "Other expenses", kind: "expense", deductiblePct: 1, itcPct: 1, examples: "Meet fees and costs incurred coaching athletes at competitions" },
  { key: "other", label: "Other business expenses", t2125Line: "9270", t2125Label: "Other expenses", kind: "expense", deductiblePct: 1, itcPct: 1, examples: "Anything business-related that fits nowhere else" },
  { key: "equipment_capital", label: "Equipment over $500 (CCA class 8)", t2125Line: "9936", t2125Label: "Capital cost allowance (CCA)", kind: "capital", deductiblePct: 1, itcPct: 1, ccaRate: 0.2, ccaClass: "8", examples: "Racks, barbells, plate sets, cameras, furniture" },
  { key: "computer_capital", label: "Computers & devices (CCA class 50)", t2125Line: "9936", t2125Label: "Capital cost allowance (CCA)", kind: "capital", deductiblePct: 1, itcPct: 1, ccaRate: 0.55, ccaClass: "50", examples: "Laptop, iPad, phone hardware" },
  { key: "personal", label: "Personal (not deductible)", t2125Line: null, t2125Label: null, kind: "excluded", deductiblePct: 0, itcPct: 0, examples: "Personal groceries, clothing, gym membership for yourself" },
  { key: "uncategorized", label: "Uncategorized", t2125Line: "9270", t2125Label: "Other expenses", kind: "expense", deductiblePct: 1, itcPct: 1, examples: "Not sorted yet" },
];

const BY_KEY = new Map(EXPENSE_CATEGORIES.map((c) => [c.key, c]));

export function expenseCategory(key: string | null | undefined): ExpenseCategory {
  return BY_KEY.get(key ?? "") ?? BY_KEY.get("uncategorized")!;
}

export function isExpenseCategoryKey(key: string): boolean {
  return BY_KEY.has(key);
}

/** Categories offered in pickers (uncategorized is a state, not a choice). */
export const PICKABLE_CATEGORIES = EXPENSE_CATEGORIES.filter((c) => c.key !== "uncategorized");
