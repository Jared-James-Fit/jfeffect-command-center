/** Format a ticket number as a human-readable string (e.g. #T-001042). */
export function formatTicket(n: number | null | undefined): string {
  if (!n && n !== 0) return "#T-—";
  return `#T-${String(n).padStart(6, "0")}`;
}