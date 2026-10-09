/**
 * Coaching Agreement server functions.
 *
 * Reads run on the caller's own session, so RLS decides who can see what (a client
 * sees their own rows; admins and the assigned coach see their clients'). Writes run
 * on the service role after the caller has been authenticated and every field has
 * been re-validated here: the browser never supplies the agreement text, the
 * acknowledgement wording, the version, the time or the network details.
 *
 * Every read degrades to "not applicable" if the tables are unavailable, so a
 * deploy that lands before its migration can never put a broken popup in front of
 * clients.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PovInput, isPovRequest, resolvePovClientId } from "@/lib/client-pov.server";
import { AGREEMENT_CONTENT, AGREEMENT_VERSION, COACH } from "@/lib/coaching-agreement/content";
import {
  buildRoster,
  summarizeRoster,
  type RosterClientInput,
  type RosterSignatureInput,
  type RosterStateInput,
} from "@/lib/coaching-agreement/roster";
import {
  isMinor,
  ageOnDate,
  namesMatch,
  resolveAgreementState,
  type AgreementState,
  type ExemptKind,
  type SignatureSummary,
} from "@/lib/coaching-agreement/rules";
import {
  clientIdSchema,
  signPayloadSchema,
  signatureIdSchema,
  setExemptionSchema,
  requestResignSchema,
} from "@/lib/coaching-agreement/schemas";
import { assertAdminView } from "@/lib/permissions.server";

export type AgreementStateResponse = {
  applicable: boolean;
  reason: "ok" | "no_client" | "staff" | "inactive" | "unavailable";
  clientId: string | null;
  firstName: string | null;
  state: AgreementState | null;
  currentVersion: string;
  contentHash: string;
  legacy: { signed: boolean; version: string | null; date: string | null };
};

const EMPTY_LEGACY = { signed: false, version: null, date: null } as const;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Service-role client. Cast because the generated database types don't know the new
// agreement tables until they are regenerated (same convention as the other new tables).
async function getAdminClient(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function currentHash(): Promise<string> {
  const { CURRENT_CONTENT_HASH } = await import("@/lib/coaching-agreement.server");
  return CURRENT_CONTENT_HASH;
}

function rowToSummary(row: any): SignatureSummary {
  const version = Array.isArray(row.coaching_agreement_versions)
    ? row.coaching_agreement_versions[0]?.version
    : row.coaching_agreement_versions?.version;
  return {
    id: row.id,
    version: version ?? "0",
    signedAt: row.signed_at,
    typedName: row.typed_name,
    method: row.signature_method,
    hasGuardian: !!row.guardian,
  };
}

function exemptionOf(adminState: any) {
  return adminState?.exempt_kind
    ? {
        kind: adminState.exempt_kind as ExemptKind,
        note: (adminState.exempt_note as string | null) ?? null,
        setAt: (adminState.exempt_set_at as string | null) ?? null,
      }
    : null;
}

async function loadAgreementForClient(supabase: any, clientId: string) {
  const [sigRes, stateRes] = await Promise.all([
    supabase
      .from("coaching_agreement_signatures")
      .select(
        "id, signed_at, typed_name, signature_method, guardian, coaching_agreement_versions(version)",
      )
      .eq("client_id", clientId)
      .order("signed_at", { ascending: false })
      .limit(50),
    supabase
      .from("coaching_agreement_client_state")
      .select("*")
      .eq("client_id", clientId)
      .maybeSingle(),
  ]);
  if (sigRes.error) throw new Error(sigRes.error.message);
  if (stateRes.error) throw new Error(stateRes.error.message);

  const signatures: SignatureSummary[] = (sigRes.data ?? []).map(rowToSummary);
  const adminState = stateRes.data ?? null;
  const state = resolveAgreementState({
    latestSignature: signatures[0] ?? null,
    exempt: exemptionOf(adminState),
    resignRequestedAt: adminState?.resign_requested_at ?? null,
    resignNote: adminState?.resign_note ?? null,
  });
  return { signatures, adminState, state };
}

function isActiveClient(client: any): boolean {
  if (!client) return false;
  if (client.archived) return false;
  if (client.portal_access_disabled) return false;
  const status = String(client.status ?? "");
  return status !== "Archived" && status !== "Deactivated";
}

function firstNameOf(client: any): string | null {
  const preferred = String(client?.preferred_name ?? "").trim();
  if (preferred) return preferred.split(/\s+/)[0];
  const first = String(client?.first_name ?? "").trim();
  if (first) return first;
  const full = String(client?.full_name ?? "").trim();
  return full ? full.split(/\s+/)[0] : null;
}

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

/** Admin, or the coach assigned to this client (read access only). */
async function assertStaffForClient(supabase: any, userId: string, clientId: string) {
  const [{ data: isAdmin }, { data: isCoach }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("is_assigned_coach", { _client_id: clientId }),
  ]);
  if (!isAdmin && !isCoach) throw new Error("Forbidden");
  return { isAdmin: !!isAdmin };
}

async function logEvent(
  admin: any,
  event: {
    clientId: string;
    signatureId?: string | null;
    type: string;
    actorUserId?: string | null;
    actorRole?: string;
    details?: Record<string, unknown>;
  },
) {
  await admin.from("coaching_agreement_events").insert({
    client_id: event.clientId,
    signature_id: event.signatureId ?? null,
    event_type: event.type,
    actor_user_id: event.actorUserId ?? null,
    actor_role: event.actorRole ?? "admin",
    details: event.details ?? {},
  });
}

// ---------------------------------------------------------------------------
// Client: status
// ---------------------------------------------------------------------------

export const getMyAgreementState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PovInput.parse(d ?? {}))
  .handler(async ({ data: pov, context }): Promise<AgreementStateResponse> => {
    const { supabase, userId } = context as any;
    const contentHash = await currentHash();
    const base = {
      clientId: null,
      firstName: null,
      state: null,
      currentVersion: AGREEMENT_VERSION,
      contentHash,
      legacy: { ...EMPTY_LEGACY },
    };
    try {
      const clientId = await resolvePovClientId(supabase, userId, pov);
      if (!clientId) return { ...base, applicable: false, reason: "no_client" };

      const { data: client, error } = await supabase
        .from("clients")
        .select(
          "id, first_name, preferred_name, full_name, archived, status, portal_access_disabled, agreement_signed, agreement_version, agreement_signed_date",
        )
        .eq("id", clientId)
        .maybeSingle();
      if (error || !client) return { ...base, applicable: false, reason: "no_client" };

      if (!isActiveClient(client)) {
        return { ...base, clientId, applicable: false, reason: "inactive" };
      }

      // Admins and coaches are never asked to sign as a client.
      if (!isPovRequest(userId, pov)) {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", userId);
        const names = (roles ?? []).map((r: any) => r.role);
        if (names.includes("admin") || names.includes("coach")) {
          return { ...base, clientId, applicable: false, reason: "staff" };
        }
      }

      const { state } = await loadAgreementForClient(supabase, clientId);
      return {
        applicable: true,
        reason: "ok",
        clientId,
        firstName: firstNameOf(client),
        state,
        currentVersion: AGREEMENT_VERSION,
        contentHash,
        legacy: {
          signed: !!client.agreement_signed,
          version: client.agreement_version ?? null,
          date: client.agreement_signed_date ?? null,
        },
      };
    } catch (e) {
      // Tables missing, network blip, etc.: never nag or block when we cannot be sure.
      console.error("[coaching-agreement] state unavailable", e);
      return { ...base, applicable: false, reason: "unavailable" };
    }
  });

// ---------------------------------------------------------------------------
// Client: signing
// ---------------------------------------------------------------------------

export type SigningContext = {
  clientId: string;
  contentHash: string;
  currentVersion: string;
  state: AgreementState;
  isMinor: boolean;
  profile: {
    fullName: string;
    email: string;
    phone: string;
    dateOfBirth: string | null;
    street: string;
    city: string;
    province: string;
    postalCode: string;
    country: string;
    emergencyContactName: string;
    emergencyContactPhone: string;
  };
  consents: { testimonial_use: boolean; social_publication: boolean };
  legacy: { signed: boolean; version: string | null; date: string | null };
};

export const getAgreementSigningContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SigningContext> => {
    const { supabase, userId, claims } = context as any;
    const { data: client, error } = await supabase
      .from("clients")
      .select(
        "id, full_name, email, phone, date_of_birth, address, city, province, postal_code, country, emergency_contact_name, emergency_contact_phone, archived, status, portal_access_disabled, agreement_signed, agreement_version, agreement_signed_date",
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !client) throw new Error("We couldn't find your client profile.");
    if (!isActiveClient(client))
      throw new Error("Your account isn't active, so there's nothing to sign.");

    const { state } = await loadAgreementForClient(supabase, client.id);
    const { data: consentRows } = await supabase
      .from("legal_consent_preferences")
      .select("consent_key, granted")
      .eq("user_id", userId);
    const consent = (key: string) =>
      !!(consentRows ?? []).find((r: any) => r.consent_key === key)?.granted;

    return {
      clientId: client.id,
      contentHash: await currentHash(),
      currentVersion: AGREEMENT_VERSION,
      state,
      isMinor: isMinor(client.date_of_birth, new Date()),
      profile: {
        fullName: client.full_name ?? "",
        email: client.email ?? claims?.email ?? "",
        phone: client.phone ?? "",
        dateOfBirth: client.date_of_birth ?? null,
        street: client.address ?? "",
        city: client.city ?? "",
        province: client.province ?? "",
        postalCode: client.postal_code ?? "",
        country: client.country ?? "Canada",
        emergencyContactName: client.emergency_contact_name ?? "",
        emergencyContactPhone: client.emergency_contact_phone ?? "",
      },
      consents: {
        testimonial_use: consent("testimonial_use"),
        social_publication: consent("social_publication"),
      },
      legacy: {
        signed: !!client.agreement_signed,
        version: client.agreement_version ?? null,
        date: client.agreement_signed_date ?? null,
      },
    };
  });

export const signCoachingAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => signPayloadSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context as any;
    const server = await import("@/lib/coaching-agreement.server");
    const supabaseAdmin = await getAdminClient();

    // 1) The signer must be the owner of an active client profile.
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select(
        "id, user_id, full_name, first_name, preferred_name, email, date_of_birth, archived, status, portal_access_disabled",
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (clientError || !client) throw new Error("We couldn't find your client profile.");
    if (!isActiveClient(client))
      throw new Error("Your account isn't active, so there's nothing to sign.");

    // 2) They must have reviewed the version that is current right now.
    if (data.contentHash !== server.CURRENT_CONTENT_HASH) {
      throw new Error(
        "agreement_changed: The agreement was updated while you were reading it. Please reopen it and review the latest version.",
      );
    }

    // 3) Date of birth: the profile is authoritative when it has one.
    const now = new Date();
    const profileDob: string | null = client.date_of_birth ?? null;
    if (profileDob && data.details.dateOfBirth !== profileDob) {
      throw new Error(
        "The date of birth you entered doesn't match your profile. Message your coach if it needs correcting.",
      );
    }
    const dob = profileDob ?? data.details.dateOfBirth;
    const minor = isMinor(dob, now);
    const age = ageOnDate(dob, now);

    if (minor) {
      if (!data.guardian) {
        throw new Error(
          "Because you're under 18, a parent or legal guardian must complete the signature too.",
        );
      }
      if (data.guardian.signatureMethod === "drawn" && !data.guardian.signatureImage) {
        throw new Error("The parent or guardian needs to draw their signature.");
      }
    }

    // 4) Every acknowledgement is required, and only known ones are accepted.
    const requiredIds = AGREEMENT_CONTENT.acknowledgements.map((a) => a.id);
    if (!requiredIds.every((id) => data.acknowledged.includes(id))) {
      throw new Error("Please tick every acknowledgement before signing.");
    }
    if (data.acknowledged.some((id) => !requiredIds.includes(id))) {
      throw new Error(
        "One of the acknowledgements is no longer valid. Please reopen the agreement.",
      );
    }

    // 5) Optional permissions: known keys only, as plain booleans.
    const knownConsents = AGREEMENT_CONTENT.optionalConsents.map((c) => c.key as string);
    const optionalConsents: Record<string, boolean> = {};
    for (const key of knownConsents) optionalConsents[key] = data.optionalConsents[key] === true;

    // 6) Take the agreement text, wording, time and network details from the server.
    const meta = await server.getRequestMeta();
    const version = await server.ensureCurrentVersion(supabaseAdmin);
    const nowIso = now.toISOString();
    const typedName = data.typedLegalName.trim();
    const email = client.email ?? claims?.email ?? null;
    const d = data.details;

    const details = {
      legal_name: typedName,
      profile_name: client.full_name,
      name_matches_profile: namesMatch(typedName, client.full_name),
      email,
      phone: d.phone.trim(),
      date_of_birth: dob,
      age_at_signing: age,
      is_minor: minor,
      address: {
        street: d.address.street.trim(),
        city: d.address.city.trim(),
        province: d.address.province.trim(),
        postal_code: d.address.postalCode.trim(),
        country: d.address.country.trim(),
      },
      emergency_contact_1: {
        name: d.emergencyContact1.name.trim(),
        phone: d.emergencyContact1.phone.trim(),
      },
      emergency_contact_2: d.emergencyContact2
        ? { name: d.emergencyContact2.name.trim(), phone: d.emergencyContact2.phone.trim() }
        : null,
      payor: d.payor
        ? {
            name: d.payor.name.trim(),
            relationship: d.payor.relationship.trim(),
            phone: d.payor.phone.trim(),
            email: d.payor.email.trim(),
            confirmation: AGREEMENT_CONTENT.payorStatement,
            confirmed_at: nowIso,
          }
        : null,
    };

    const guardian =
      minor && data.guardian
        ? {
            full_name: data.guardian.fullName.trim(),
            relationship: data.guardian.relationship.trim(),
            phone: data.guardian.phone.trim(),
            signature_method: data.guardian.signatureMethod,
            signature_image: data.guardian.signatureImage,
            statement: AGREEMENT_CONTENT.guardianStatement,
            acknowledged_at: nowIso,
          }
        : null;

    const acknowledgements = AGREEMENT_CONTENT.acknowledgements.map((a) => ({
      id: a.id,
      short: a.short,
      text: a.text,
      acknowledged_at: nowIso,
    }));

    const { data: result, error } = await supabaseAdmin.rpc("coaching_agreement_record_signature", {
      p: {
        user_id: userId,
        client_id: client.id,
        version_id: version.id,
        client_name: client.full_name,
        client_email: email,
        typed_name: typedName,
        signature_method: data.signatureMethod,
        signature_image: data.signatureMethod === "drawn" ? data.signatureImage : null,
        details,
        acknowledgements,
        optional_consents: optionalConsents,
        guardian,
        review: {
          sections_opened: data.review.sectionsOpened,
          review_seconds: data.review.reviewSeconds,
          scrolled_to_end: data.review.scrolledToEnd,
        },
        intent_statement: AGREEMENT_CONTENT.intentStatement,
        signer_timezone: data.timezone ?? null,
        ip_address: meta.ip,
        user_agent: meta.userAgent,
        idempotency_key: data.idempotencyKey,
      },
    });
    if (error) {
      console.error("[coaching-agreement] signing failed", error);
      throw new Error("We couldn't save your signature. Please try again.");
    }

    const signatureId = (result as any)?.id as string;
    const duplicate = !!(result as any)?.duplicate;

    // 7) Receipt + coach notification are best-effort and never undo a valid signature.
    if (!duplicate) {
      try {
        const emailResult = await server.enqueueAgreementEmail(supabaseAdmin, {
          template: "agreement-signed",
          recipient: email,
          dedupeKey: `agreement_signed:${signatureId}:email`,
          data: {
            first_name: firstNameOf(client),
            typed_name: typedName,
            version: version.version,
            signed_at_label: server.winnipegLabel(nowIso),
            fingerprint: version.hash.slice(0, 12),
            view_url: `${server.publicOrigin()}/portal/agreements`,
            support_email: COACH.email,
          },
        });
        if (emailResult.sent) {
          await supabaseAdmin
            .from("coaching_agreement_signatures")
            .update({ receipt_emailed_at: new Date().toISOString() })
            .eq("id", signatureId);
          await logEvent(supabaseAdmin, {
            clientId: client.id,
            signatureId,
            type: "receipt_emailed",
            actorUserId: userId,
            actorRole: "system",
          });
        }
      } catch (e) {
        console.warn("[coaching-agreement] receipt email failed", e);
      }
      try {
        const { notifyAppEvent } = await import("@/lib/push/app-events.server");
        await notifyAppEvent(supabaseAdmin, "agreement_signed", {
          clientId: client.id,
          sourceId: signatureId,
          actorUserId: userId,
        });
      } catch (e) {
        console.warn("[coaching-agreement] staff push failed", e);
      }
    }

    return { ok: true as const, signatureId, duplicate };
  });

// ---------------------------------------------------------------------------
// Client (and staff viewing a client): the signed copy
// ---------------------------------------------------------------------------

export const listMyAgreementSignatures = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PovInput.parse(d ?? {}))
  .handler(async ({ data: pov, context }) => {
    const { supabase, userId } = context as any;
    try {
      const clientId = await resolvePovClientId(supabase, userId, pov);
      if (!clientId) return [] as SignatureSummary[];
      const { signatures } = await loadAgreementForClient(supabase, clientId);
      return signatures;
    } catch (e) {
      console.error("[coaching-agreement] list unavailable", e);
      return [] as SignatureSummary[];
    }
  });

export type AgreementRecord = {
  id: string;
  clientId: string | null;
  clientName: string;
  clientEmail: string | null;
  typedName: string;
  signatureMethod: "drawn" | "typed";
  signatureImage: string | null;
  details: Record<string, any>;
  acknowledgements: { id: string; short?: string; text: string; acknowledged_at: string }[];
  optionalConsents: Record<string, boolean>;
  guardian: Record<string, any> | null;
  review: Record<string, any>;
  intentStatement: string;
  signedAt: string;
  signerTimezone: string | null;
  receiptEmailedAt: string | null;
  /** Network and device details are for staff only. */
  audit: { ip: string | null; userAgent: string | null; verification: string } | null;
  version: string;
  effectiveDate: string;
  contentHash: string;
  /** False if the stored text no longer matches its fingerprint (should never happen). */
  integrity: boolean;
  contentJson: string;
};

export const getAgreementRecord = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => signatureIdSchema.parse(d))
  .handler(async ({ data, context }): Promise<AgreementRecord> => {
    const { supabase, userId } = context as any;
    const { sha256Hex } = await import("@/lib/coaching-agreement.server");

    const { data: row, error } = await supabase
      .from("coaching_agreement_signatures")
      .select(
        "id, client_id, client_name, client_email, typed_name, signature_method, signature_image, details, acknowledgements, optional_consents, guardian, review, intent_statement, signed_at, signer_timezone, ip_address, user_agent, verification_method, receipt_emailed_at, coaching_agreement_versions(version, content_hash, content_json, effective_date)",
      )
      .eq("id", data.signatureId)
      .maybeSingle();
    // RLS returns nothing for anyone who isn't the signer, an admin or the assigned coach.
    if (error || !row) throw new Error("Signed agreement not found");

    const v = Array.isArray(row.coaching_agreement_versions)
      ? row.coaching_agreement_versions[0]
      : row.coaching_agreement_versions;
    if (!v) throw new Error("Signed agreement not found");

    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const names = (roles ?? []).map((r: any) => r.role);
    const isStaff = names.includes("admin") || names.includes("coach");

    return {
      id: row.id,
      clientId: row.client_id,
      clientName: row.client_name,
      clientEmail: row.client_email,
      typedName: row.typed_name,
      signatureMethod: row.signature_method,
      signatureImage: row.signature_image,
      details: row.details ?? {},
      acknowledgements: row.acknowledgements ?? [],
      optionalConsents: row.optional_consents ?? {},
      guardian: row.guardian ?? null,
      review: row.review ?? {},
      intentStatement: row.intent_statement,
      signedAt: row.signed_at,
      signerTimezone: row.signer_timezone,
      receiptEmailedAt: row.receipt_emailed_at,
      audit: isStaff
        ? { ip: row.ip_address, userAgent: row.user_agent, verification: row.verification_method }
        : null,
      version: v.version,
      effectiveDate: v.effective_date,
      contentHash: v.content_hash,
      integrity: sha256Hex(v.content_json) === v.content_hash,
      contentJson: v.content_json,
    };
  });

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
): Promise<T[]> {
  const out: T[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await build(from, from + page - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < page) break;
  }
  return out;
}

async function loadRoster(supabase: any, clientIds?: string[]) {
  const clients = await fetchAll<any>((from, to) => {
    let q = supabase
      .from("clients")
      .select(
        "id, full_name, email, user_id, assigned_coach_id, archived, status, portal_access_disabled, agreement_signed, agreement_signed_date, agreement_version, last_signed_in_at",
      )
      .not("user_id", "is", null)
      .eq("archived", false)
      .order("id");
    if (clientIds) q = q.in("id", clientIds);
    return q.range(from, to);
  });
  const active: RosterClientInput[] = clients.filter(isActiveClient);

  const sigRows = await fetchAll<any>((from, to) =>
    supabase
      .from("coaching_agreement_signatures")
      .select(
        "id, client_id, signed_at, typed_name, signature_method, guardian, coaching_agreement_versions(version)",
      )
      .order("signed_at", { ascending: false })
      .range(from, to),
  );
  const signatures: RosterSignatureInput[] = sigRows.map((r: any) => ({
    id: r.id,
    client_id: r.client_id,
    signed_at: r.signed_at,
    typed_name: r.typed_name,
    signature_method: r.signature_method,
    has_guardian: !!r.guardian,
    version: rowToSummary(r).version,
  }));

  const states: RosterStateInput[] = await fetchAll<any>((from, to) =>
    supabase.from("coaching_agreement_client_state").select("*").order("client_id").range(from, to),
  );

  return buildRoster(active, signatures, states);
}

export const adminAgreementRoster = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as any;
    const { db: supabase } = await assertAdminView(context as any);
    const rows = await loadRoster(supabase);
    return { currentVersion: AGREEMENT_VERSION, rows, counts: summarizeRoster(rows) };
  });

export const adminClientAgreementDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => clientIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { isAdmin } = await assertStaffForClient(supabase, userId, data.clientId);

    const { data: client } = await supabase
      .from("clients")
      .select(
        "id, full_name, email, user_id, archived, status, portal_access_disabled, agreement_signed, agreement_status, agreement_version, agreement_signed_date",
      )
      .eq("id", data.clientId)
      .maybeSingle();
    if (!client) throw new Error("Client not found");

    const { signatures, adminState, state } = await loadAgreementForClient(supabase, data.clientId);
    const { data: events } = await supabase
      .from("coaching_agreement_events")
      .select("id, event_type, actor_role, details, created_at, signature_id")
      .eq("client_id", data.clientId)
      .order("created_at", { ascending: false })
      .limit(40);

    return {
      canManage: isAdmin,
      hasAccount: !!client.user_id,
      currentVersion: AGREEMENT_VERSION,
      state,
      signatures,
      events: events ?? [],
      resignRequestedAt: adminState?.resign_requested_at ?? null,
      resignNote: adminState?.resign_note ?? null,
      exempt: exemptionOf(adminState),
      lastRemindedAt: adminState?.last_reminded_at ?? null,
      reminderCount: adminState?.reminder_count ?? 0,
      legacy: {
        signed: !!client.agreement_signed,
        status: client.agreement_status ?? null,
        version: client.agreement_version ?? null,
        date: client.agreement_signed_date ?? null,
      },
    };
  });

async function notifyClientToSign(
  admin: any,
  args: {
    client: any;
    actorUserId: string;
    note?: string | null;
    kind: "request" | "remind";
    isFirst: boolean;
  },
) {
  const server = await import("@/lib/coaching-agreement.server");
  const { coachLabel } = await import("@/lib/push/notification-payload");
  const { notifyAppEvent } = await import("@/lib/push/app-events.server");

  const { data: actor } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", args.actorUserId)
    .maybeSingle();
  const coachName = coachLabel(actor?.full_name ?? "");

  const now = new Date();
  const period =
    args.kind === "remind" ? now.toISOString().slice(0, 10) : now.toISOString().slice(0, 13);
  const email = await server.enqueueAgreementEmail(admin, {
    template: "agreement-requested",
    recipient: args.client.email,
    dedupeKey: `agreement_${args.kind}:${args.client.id}:${period}`,
    data: {
      first_name: firstNameOf(args.client),
      coach_name: coachName,
      custom_note: args.note?.trim() || undefined,
      sign_url: `${server.publicOrigin()}/portal/agreements?sign=1`,
      support_email: COACH.email,
      is_first: args.isFirst,
    },
  });
  const push = await notifyAppEvent(admin, "agreement_requested", {
    clientId: args.client.id,
    sourceId: `${args.kind}:${args.client.id}:${period}`,
    actorUserId: args.actorUserId,
  });
  return { emailed: email.sent, pushed: (push as any)?.sent ?? 0 };
}

export const adminRequestAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => requestResignSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const supabaseAdmin = await getAdminClient();

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id, user_id, email, full_name, first_name, preferred_name")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!client) throw new Error("Client not found");
    if (!client.user_id) throw new Error("This client doesn't have an app account yet.");

    const { count } = await supabaseAdmin
      .from("coaching_agreement_signatures")
      .select("id", { count: "exact", head: true })
      .eq("client_id", client.id);
    const now = new Date().toISOString();
    const note = data.note?.trim() || null;

    const { error } = await supabaseAdmin.from("coaching_agreement_client_state").upsert(
      {
        client_id: client.id,
        resign_requested_at: now,
        resign_requested_by: userId,
        resign_note: note,
        // A fresh request replaces any earlier "not required" exemption.
        exempt_kind: null,
        exempt_note: null,
        exempt_set_at: null,
        exempt_set_by: null,
      },
      { onConflict: "client_id" },
    );
    if (error) throw new Error(error.message);

    await logEvent(supabaseAdmin, {
      clientId: client.id,
      type: "requested",
      actorUserId: userId,
      details: { note, first_time: (count ?? 0) === 0 },
    });

    const sent = await notifyClientToSign(supabaseAdmin, {
      client,
      actorUserId: userId,
      note,
      kind: "request",
      isFirst: (count ?? 0) === 0,
    });
    return { ok: true as const, ...sent };
  });

export const adminCancelAgreementRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => clientIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const supabaseAdmin = await getAdminClient();
    const { error } = await supabaseAdmin
      .from("coaching_agreement_client_state")
      .update({ resign_requested_at: null, resign_requested_by: null, resign_note: null })
      .eq("client_id", data.clientId);
    if (error) throw new Error(error.message);
    await logEvent(supabaseAdmin, {
      clientId: data.clientId,
      type: "request_cancelled",
      actorUserId: userId,
    });
    return { ok: true as const };
  });

export const adminSetAgreementExemption = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => setExemptionSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const supabaseAdmin = await getAdminClient();
    const note = data.note?.trim() || null;
    const { error } = await supabaseAdmin.from("coaching_agreement_client_state").upsert(
      {
        client_id: data.clientId,
        exempt_kind: data.kind,
        exempt_note: note,
        exempt_set_at: new Date().toISOString(),
        exempt_set_by: userId,
      },
      { onConflict: "client_id" },
    );
    if (error) throw new Error(error.message);
    await logEvent(supabaseAdmin, {
      clientId: data.clientId,
      type: "exempted",
      actorUserId: userId,
      details: { kind: data.kind, note },
    });
    return { ok: true as const };
  });

export const adminClearAgreementExemption = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => clientIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const supabaseAdmin = await getAdminClient();
    const { error } = await supabaseAdmin
      .from("coaching_agreement_client_state")
      .update({ exempt_kind: null, exempt_note: null, exempt_set_at: null, exempt_set_by: null })
      .eq("client_id", data.clientId);
    if (error) throw new Error(error.message);
    await logEvent(supabaseAdmin, {
      clientId: data.clientId,
      type: "exemption_removed",
      actorUserId: userId,
    });
    return { ok: true as const };
  });

const REMIND_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const adminRemindAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ clientIds: z.array(z.string().uuid()).min(1).max(500) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const supabaseAdmin = await getAdminClient();

    const rows = await loadRoster(supabase, data.clientIds);
    const outstanding = rows.filter((r) => r.state.state === "needs_signature" && r.hasAccount);

    let reminded = 0;
    let skippedRecent = 0;
    let emailed = 0;
    let pushed = 0;
    const nowMs = Date.now();

    for (const row of outstanding) {
      if (
        row.lastRemindedAt &&
        nowMs - new Date(row.lastRemindedAt).getTime() < REMIND_COOLDOWN_MS
      ) {
        skippedRecent += 1;
        continue;
      }
      const { data: client } = await supabaseAdmin
        .from("clients")
        .select("id, email, full_name, first_name, preferred_name")
        .eq("id", row.clientId)
        .maybeSingle();
      if (!client) continue;

      const sent = await notifyClientToSign(supabaseAdmin, {
        client,
        actorUserId: userId,
        kind: "remind",
        isFirst: row.signatureCount === 0,
      });
      if (sent.emailed) emailed += 1;
      pushed += sent.pushed;

      await supabaseAdmin.from("coaching_agreement_client_state").upsert(
        {
          client_id: row.clientId,
          last_reminded_at: new Date().toISOString(),
          reminder_count: row.reminderCount + 1,
        },
        { onConflict: "client_id" },
      );
      await logEvent(supabaseAdmin, {
        clientId: row.clientId,
        type: "reminded",
        actorUserId: userId,
        details: { emailed: sent.emailed, pushed: sent.pushed },
      });
      reminded += 1;
    }

    return {
      ok: true as const,
      reminded,
      skippedRecent,
      notOutstanding: data.clientIds.length - outstanding.length,
      emailed,
      pushed,
    };
  });
