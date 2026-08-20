export type DiscountOverviewRow = {
  id: string;
  status: string | null;
};

/**
 * Counts active internal discount-code records for the admin payments overview.
 * The overview intentionally reads only fields it displays, so it never selects
 * a non-existent legacy `code` column or exposes code text unnecessarily.
 */
export function countActiveDiscountCodes(rows: readonly DiscountOverviewRow[]): number {
  return rows.filter((row) => row.status === "active").length;
}
