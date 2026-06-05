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
  const res = await signnowFetch("/user/documentsv2?filter=template-only&per_page=100");
  const text = await res.text();
  if (!res.ok) throw new SignNowApiError(res.status, text);
  const json = JSON.parse(text);
  const docs = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  return docs
    .filter((d: any) => d?.template === true || d?.is_template === 1 || d?.template === 1)
    .map((d: any) => ({
      id: d.id ?? d.document_id,
      name: d.document_name ?? d.name ?? "Untitled template",
      updated: typeof d.updated === "number" ? d.updated : null,
    }))
    .filter((t: SignNowTemplateRef) => !!t.id && !!t.name);
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
  const body = {
    document_id: opts.documentId,
    to: [
      {
        email: opts.signerEmail,
        role_name: "Recipient 1",
        role: "Recipient 1",
        order: 1,
        ...(opts.expirationDays ? { expiration_days: opts.expirationDays } : {}),
        ...(opts.subject ? { subject: opts.subject } : {}),
        ...(opts.message ? { message: opts.message } : {}),
      },
    ],
    from: opts.fromEmail,
    ...(opts.subject ? { subject: opts.subject } : {}),
    ...(opts.message ? { message: opts.message } : {}),
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