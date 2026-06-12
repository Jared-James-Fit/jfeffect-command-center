/**
 * SignNow API helpers — server-only.
 * All process.env reads happen inside exported async functions, never at module scope,
 * so secrets are never bundled to the client and undefined reads only happen at call time.
 *
 * Activates automatically when the following secrets are present:
 *   SIGNNOW_CLIENT_ID, SIGNNOW_CLIENT_SECRET, SIGNNOW_USERNAME, SIGNNOW_PASSWORD
 * Falls back to a static SIGNNOW_API_TOKEN if provided (legacy).
 * If neither is present, every call throws `SignNowNotConfiguredError` which callers
 * should treat as Manual Mode Only — no UI should ever surface "Connected" / "Sent"
 * unless one of these calls succeeded.
 */

const SIGNNOW_BASE = "https://api.signnow.com";

export class SignNowNotConfiguredError extends Error {
  constructor() {
    super("SignNow API is not configured. Running in Manual Mode Only.");
    this.name = "SignNowNotConfiguredError";
  }
}

export class SignNowApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`SignNow API error ${status}: ${body.slice(0, 200)}`);
    this.name = "SignNowApiError";
    this.status = status;
    this.body = body;
  }
}

function readCreds() {
  const clientId = process.env.SIGNNOW_CLIENT_ID;
  const clientSecret = process.env.SIGNNOW_CLIENT_SECRET;
  const username = process.env.SIGNNOW_USERNAME;
  const password = process.env.SIGNNOW_PASSWORD;
  const staticToken = process.env.SIGNNOW_API_TOKEN;
  return { clientId, clientSecret, username, password, staticToken };
}

export function hasSignNowCredentials(): boolean {
  const { clientId, clientSecret, username, password, staticToken } = readCreds();
  return !!staticToken || !!(clientId && clientSecret && username && password);
}

/** OAuth password grant. Returns a short-lived bearer token. */
export async function getSignNowAccessToken(): Promise<string> {
  const { clientId, clientSecret, username, password, staticToken } = readCreds();
  if (staticToken) return staticToken;
  if (!clientId || !clientSecret || !username || !password) {
    throw new SignNowNotConfiguredError();
  }
  const basic = btoa(`${clientId}:${clientSecret}`);
  const body = new URLSearchParams({
    grant_type: "password",
    username,
    password,
    scope: "*",
  });
  const res = await fetch(`${SIGNNOW_BASE}/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new SignNowApiError(res.status, text);
  const json = JSON.parse(text);
  if (!json?.access_token) throw new SignNowApiError(res.status, "No access_token in response");
  return json.access_token as string;
}

async function signnowFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getSignNowAccessToken();
  return fetch(`${SIGNNOW_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init.body && !(init.headers as any)?.["Content-Type"]
        ? { "Content-Type": "application/json" }
        : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

export interface SignNowTemplateRef {
  id: string;
  name: string;
  updated?: number | null;
}

/** List templates owned by the authenticated SignNow user. */
export async function listSignNowTemplates(): Promise<SignNowTemplateRef[]> {
  // documentsv2 supports filter=template-only; legacy /user/documentsv2 returns paginated results.
  // We paginate to be safe, then aggressively filter out anything that isn't a
  // live, non-trashed template owned by this account. SignNow returns deleted /
  // archived / trashed templates here even though they don't appear in the UI,
  // which is why the sync used to pick up "phantom" templates.
  const out: SignNowTemplateRef[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 10; page += 1) {
    const res = await signnowFetch(
      `/user/documentsv2?filter=template-only&per_page=100&page=${page}`,
    );
    const text = await res.text();
    if (!res.ok) throw new SignNowApiError(res.status, text);
    const json = JSON.parse(text);
    const docs = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
    if (docs.length === 0) break;
    for (const d of docs) {
      const id = d?.id ?? d?.document_id;
      if (!id || seen.has(id)) continue;
      // Must be flagged as a template.
      const isTemplate = d?.template === true || d?.is_template === 1 || d?.template === 1;
      if (!isTemplate) continue;
      // Exclude anything SignNow considers removed / trashed / deleted.
      const removed =
        d?.removed === true || d?.removed === 1 ||
        d?.deleted === true || d?.deleted === 1 ||
        d?.trash === true || d?.trash === 1 ||
        d?.is_trash === true || d?.is_trash === 1 ||
        !!d?.deleted_at || !!d?.trashed_at;
      if (removed) continue;
      seen.add(id);
      out.push({
        id,
        name: d?.document_name ?? d?.name ?? "Untitled template",
        updated: typeof d?.updated === "number" ? d.updated : null,
      });
    }
    if (docs.length < 100) break;
  }
  return out.filter((t) => !!t.id && !!t.name);
}

/** Copy a template into a new document, returning the new document id. */
export async function copyTemplateToDocument(templateId: string, documentName: string): Promise<string> {
  const res = await signnowFetch(`/template/${encodeURIComponent(templateId)}/copy`, {
    method: "POST",
    body: JSON.stringify({ document_name: documentName.slice(0, 250) }),
  });
  const text = await res.text();
  if (!res.ok) throw new SignNowApiError(res.status, text);
  const json = JSON.parse(text);
  const id = json?.id ?? json?.document_id;
  if (!id) throw new SignNowApiError(res.status, "No document id returned from /template/copy");
  return id as string;
}

export interface SignNowInviteOptions {
  documentId: string;
  signerEmail: string;
  signerName?: string | null;
  fromEmail: string;
  subject?: string;
  message?: string;
  expirationDays?: number;
  /**
   * Role name to assign the signer to. Must exist on the SignNow document
   * (templates define their own role names; "Recipient 1" is NOT a default).
   * If omitted, callers should pre-resolve via listDocumentRoles().
   */
  roleName?: string;
  /**
   * SignNow rejects personalized invite subject/message (error 65582) on
   * standard plans. Default off — only set true when the account plan is
   * known to support personalized invites.
   */
  allowPersonalizedEmail?: boolean;
}

export interface SignNowInviteResult {
  inviteId: string | null;
  signingLink: string | null;
}

/**
 * Send a real "field invite" for an existing SignNow document.
 * Returns the invite id and a best-effort signing link.
 */
export async function createSignNowInvite(opts: SignNowInviteOptions): Promise<SignNowInviteResult> {
  const personalize = opts.allowPersonalizedEmail === true;
  const role = opts.roleName && opts.roleName.trim() ? opts.roleName.trim() : "Signer 1";
  const body = {
    document_id: opts.documentId,
    to: [
      {
        email: opts.signerEmail,
        role_name: role,
        role: role,
        order: 1,
        ...(opts.expirationDays ? { expiration_days: opts.expirationDays } : {}),
        ...(personalize && opts.subject ? { subject: opts.subject } : {}),
        ...(personalize && opts.message ? { message: opts.message } : {}),
      },
    ],
    from: opts.fromEmail,
    ...(personalize && opts.subject ? { subject: opts.subject } : {}),
    ...(personalize && opts.message ? { message: opts.message } : {}),
  };
  const res = await signnowFetch(`/document/${encodeURIComponent(opts.documentId)}/invite`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new SignNowApiError(res.status, text);
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return {
    inviteId: json?.id ?? json?.invite_id ?? null,
    signingLink: json?.url ?? json?.signing_link ?? null,
  };
}

export interface SignNowRole {
  name: string;
  uniqueId?: string | null;
  signingOrder?: number | null;
}

/**
 * List the signer roles defined on a SignNow document (or document copied from
 * a template). SignNow templates each define their own role names (e.g.
 * "Client", "Parent/Guardian"); there is no universal default. Use this to
 * resolve the actual role names before sending an invite — otherwise SignNow
 * rejects with error 65536: "Role does not exist on document".
 *
 * Strategy: GET /document/{id} and prefer the top-level `roles` array. Fall
 * back to unique role names found on the document's fields.
 */
export async function listDocumentRoles(documentId: string): Promise<SignNowRole[]> {
  const res = await signnowFetch(`/document/${encodeURIComponent(documentId)}`);
  const text = await res.text();
  if (!res.ok) throw new SignNowApiError(res.status, text);
  const json = JSON.parse(text);
  const roles: SignNowRole[] = [];
  const seen = new Set<string>();
  const push = (name: any, uniqueId?: any, order?: any) => {
    if (typeof name !== "string") return;
    const n = name.trim();
    if (!n || seen.has(n)) return;
    seen.add(n);
    roles.push({
      name: n,
      uniqueId: typeof uniqueId === "string" ? uniqueId : null,
      signingOrder: typeof order === "number" ? order : Number.isFinite(Number(order)) ? Number(order) : null,
    });
  };
  if (Array.isArray(json?.roles)) {
    for (const r of json.roles) push(r?.name, r?.unique_id ?? r?.id, r?.signing_order);
  }
  if (Array.isArray(json?.fields)) {
    for (const f of json.fields) push(f?.role, f?.role_id, f?.signing_order ?? f?.signer_index);
  }
  // Stable sort by signing order if present
  roles.sort((a, b) => (a.signingOrder ?? 999) - (b.signingOrder ?? 999));
  return roles;
}

/** Fire a SignNow reminder for an outstanding invite. */
export async function remindSignNowInvite(documentId: string): Promise<void> {
  const res = await signnowFetch(`/document/${encodeURIComponent(documentId)}/invite/reminder`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new SignNowApiError(res.status, text);
  }
}

/** Probe the API to confirm credentials are valid. Returns the SignNow account email. */
export async function whoami(): Promise<{ email: string | null }> {
  const res = await signnowFetch("/user");
  const text = await res.text();
  if (!res.ok) throw new SignNowApiError(res.status, text);
  const json = JSON.parse(text);
  return { email: json?.primary_email ?? json?.email ?? null };
}

export interface SignNowDocumentStatus {
  id: string;
  documentName: string | null;
  status: "pending" | "signed" | "completed" | "cancelled" | "expired" | "unknown";
  signerName: string | null;
  signerEmail: string | null;
  signedAt: string | null; // ISO
  raw: any;
}

function pickSignerName(json: any): string | null {
  const fields = Array.isArray(json?.fields) ? json.fields : [];
  for (const f of fields) {
    const v = f?.json_attributes?.prefilled_text ?? f?.value;
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const sigs = Array.isArray(json?.signatures) ? json.signatures : [];
  for (const s of sigs) {
    if (typeof s?.signature_name === "string" && s.signature_name.trim()) return s.signature_name.trim();
    if (typeof s?.user_name === "string" && s.user_name.trim()) return s.user_name.trim();
  }
  return null;
}

/** Fetch document metadata and infer high-level status. */
export async function getSignNowDocument(documentId: string): Promise<SignNowDocumentStatus> {
  const res = await signnowFetch(`/document/${encodeURIComponent(documentId)}`);
  const text = await res.text();
  if (!res.ok) throw new SignNowApiError(res.status, text);
  const json = JSON.parse(text);
  const signatures = Array.isArray(json?.signatures) ? json.signatures : [];
  const requests = Array.isArray(json?.requests) ? json.requests : [];
  const cancelled = !!json?.cancelled_invite || requests.some((r: any) => r?.canceled === "1" || r?.status === "cancelled");
  const allSigned = signatures.length > 0 && signatures.every((s: any) => !!s?.created || !!s?.user_id);
  const anySigned = signatures.length > 0;
  let status: SignNowDocumentStatus["status"] = "pending";
  if (cancelled) status = "cancelled";
  else if (allSigned) status = "completed";
  else if (anySigned) status = "signed";
  // signed_at — pick max signature.created (epoch seconds)
  let signedAt: string | null = null;
  if (anySigned) {
    const epochs = signatures.map((s: any) => Number(s?.created ?? 0)).filter((n: number) => Number.isFinite(n) && n > 0);
    if (epochs.length) signedAt = new Date(Math.max(...epochs) * 1000).toISOString();
  }
  const recipient = Array.isArray(json?.field_invites) && json.field_invites[0];
  return {
    id: json?.id ?? documentId,
    documentName: json?.document_name ?? null,
    status,
    signerName: pickSignerName(json),
    signerEmail: recipient?.email ?? null,
    signedAt,
    raw: json,
  };
}

/** Download the (latest) collapsed/flattened signed PDF as bytes. */
export async function downloadSignedDocument(documentId: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  // collapsed=1 returns a flattened single PDF including signatures.
  const token = await getSignNowAccessToken();
  const res = await fetch(`${SIGNNOW_BASE}/document/${encodeURIComponent(documentId)}/download?type=collapsed`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/pdf" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SignNowApiError(res.status, text);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") || "application/pdf";
  return { bytes: buf, contentType };
}

export interface SignNowDocumentSummary {
  id: string;
  name: string | null;
  updated: number | null;
  isTemplate: boolean;
  /** Hint flag from list endpoint — true iff every recipient invite signed. */
  allSigned: boolean;
  /** Hint flag from list endpoint — true if invite was cancelled. */
  cancelled: boolean;
}

/**
 * Paginated list of all (non-template) documents owned by the SignNow account.
 * Used for historical import sweeps. The list endpoint returns coarse status
 * hints; callers should fetch /document/{id} for definitive signed metadata.
 *
 * `maxPages` and `perPage` bound the scan so a runaway account doesn't burn
 * the SignNow rate limit.
 */
export async function listAllSignNowDocuments(
  opts: { maxPages?: number; perPage?: number } = {},
): Promise<SignNowDocumentSummary[]> {
  const perPage = Math.max(1, Math.min(100, opts.perPage ?? 100));
  const maxPages = Math.max(1, Math.min(20, opts.maxPages ?? 5));
  const out: SignNowDocumentSummary[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const res = await signnowFetch(
      `/user/documentsv2?per_page=${perPage}&page=${page}`,
    );
    const text = await res.text();
    if (!res.ok) throw new SignNowApiError(res.status, text);
    const json = JSON.parse(text);
    const docs = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
    if (docs.length === 0) break;
    for (const d of docs) {
      const id = d?.id ?? d?.document_id;
      if (!id) continue;
      const isTemplate = d?.template === true || d?.is_template === 1 || d?.template === 1;
      if (isTemplate) continue;
      const invites = Array.isArray(d?.field_invites) ? d.field_invites : [];
      const cancelled = !!d?.cancelled_invite || invites.some((i: any) => i?.canceled === "1" || i?.status === "cancelled");
      const allSigned = invites.length > 0 && invites.every((i: any) => i?.status === "fulfilled" || !!i?.signed_at);
      out.push({
        id,
        name: d?.document_name ?? d?.name ?? null,
        updated: typeof d?.updated === "number" ? d.updated : null,
        isTemplate: false,
        allSigned,
        cancelled,
      });
    }
    if (docs.length < perPage) break;
  }
  return out;
}