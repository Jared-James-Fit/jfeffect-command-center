/**
 * Money that came in by hand, said plainly (pure, tested): where it went
 * (a deposit account, by name and last 4 digits only) and its proof (a
 * screenshot or photo in the private payment-proofs bucket, admins and
 * finance only, under the client's id).
 */

export type DepositAccount = { id: string; label: string; institution?: string | null; last4?: string | null; is_default?: boolean | null; archived_at?: string | null };

/** Images and PDFs, up to 10 MB (the bucket enforces the same). */
export const PROOF_TYPES = ["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp", "application/pdf"] as const;
export const PROOF_MAX_BYTES = 10 * 1024 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A proof file must sit in the client's own folder (never another client's, never a path that climbs out). */
export function proofPathOk(path: string | null | undefined, clientId: string): boolean {
  if (!path) return true;
  const [folder, file, ...rest] = path.split("/");
  return rest.length === 0 && folder === clientId && UUID.test(folder) && !!file && /^[A-Za-z0-9._-]{1,120}$/.test(file) && !file.startsWith(".");
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "image/heif": "heif", "image/webp": "webp", "application/pdf": "pdf" };

/** Where a new proof goes: `<client>/<date>-<random>.<ext>`. */
export function proofPath(clientId: string, type: string, date: string, random: string): string {
  const ext = EXT[type] ?? "jpg";
  return `${clientId}/${date}-${random.replace(/[^A-Za-z0-9]/g, "").slice(0, 16)}.${ext}`;
}

/** Why a file can't be a proof (null = fine). */
export function proofProblem(file: { type: string; size: number }): string | null {
  if (!(PROOF_TYPES as readonly string[]).includes(file.type)) return "Add a photo, screenshot or PDF.";
  if (file.size > PROOF_MAX_BYTES) return "That file is over 10 MB. Take a screenshot instead.";
  return null;
}

/** "Simplii Chequing ••6360". */
export function depositLabel(a: Pick<DepositAccount, "label" | "last4"> | null | undefined): string | null {
  if (!a) return null;
  return a.last4 ? `${a.label} ••${a.last4}` : a.label;
}

/** The accounts to pick from, the default first, archived ones left out. */
export function pickableAccounts(accounts: DepositAccount[]): DepositAccount[] {
  return accounts.filter((a) => !a.archived_at).sort((a, b) => Number(!!b.is_default) - Number(!!a.is_default) || a.label.localeCompare(b.label));
}

/** The account a payment went into, when the method is one that lands in one. */
export function needsAccount(method: string): boolean {
  return method === "etransfer" || method === "bank_transfer" || method === "cheque";
}

/** "E-transfer into Simplii Chequing ••6360" / "Card through Stripe" / "Cash". */
export function paymentHow(row: { method?: string | null; source?: string | null; deposit_account_id?: string | null }, accounts: DepositAccount[]): string {
  const m = String(row.method ?? "");
  const base: Record<string, string> = {
    etransfer: "E-transfer",
    cash: "Cash",
    debit: "Debit",
    credit_card: "Card",
    bank_transfer: "Bank transfer",
    cheque: "Cheque",
    credit_balance: "Account credit",
    stripe: "Card through Stripe",
    other: "Other",
  };
  const word = base[m] ?? (m ? m[0].toUpperCase() + m.slice(1) : "Payment");
  const acc = row.deposit_account_id ? accounts.find((a) => a.id === row.deposit_account_id) : null;
  const into = depositLabel(acc);
  return into ? `${word} into ${into}` : word;
}
