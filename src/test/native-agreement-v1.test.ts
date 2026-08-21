import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  NATIVE_AGREEMENT_TITLE,
  NATIVE_AGREEMENT_VERSION,
  assertSupportedNativeSignerRoles,
  isNativeSignatureMethod,
  requireKnownDateOfBirth,
  resolveArtifactState,
} from "@/lib/native-agreement-contract";

const root = process.cwd();
const clientFunctions = readFileSync(
  resolve(root, "src/lib/native-agreement-client.functions.ts"),
  "utf8",
);
const serverFunctions = readFileSync(
  resolve(root, "src/lib/native-agreements.functions.ts"),
  "utf8",
);
const renderer = readFileSync(resolve(root, "src/lib/native-agreements-pdf.server.ts"), "utf8");
const signingRoute = readFileSync(
  resolve(root, "src/routes/_authenticated/portal/agreements-native.$packageId.tsx"),
  "utf8",
);
const migration = readFileSync(
  resolve(root, "supabase/migrations/20260821010000_harden_native_agreement_v1.sql"),
  "utf8",
);

describe("native agreement v1 contract", () => {
  it("uses the approved template identity and both approved signature methods", () => {
    expect(NATIVE_AGREEMENT_TITLE).toBe("JF Effect Coaching Agreement");
    expect(NATIVE_AGREEMENT_VERSION).toBe("v1.0");
    expect(isNativeSignatureMethod("typed")).toBe(true);
    expect(isNativeSignatureMethod("drawn")).toBe(true);
    expect(isNativeSignatureMethod("uploaded-image")).toBe(false);
  });

  it("blocks unknown DOB and defers non-client signer roles", () => {
    expect(() => requireKnownDateOfBirth(null)).toThrow("Date of birth is required");
    expect(() => assertSupportedNativeSignerRoles(["client", "payor"])).toThrow(
      "Native payor signing",
    );
    expect(() => assertSupportedNativeSignerRoles(["client"])).not.toThrow();
  });

  it("keeps signed artifacts durable without coupling completion to renderer success", () => {
    expect(resolveArtifactState({ completed: false, rendered: false, failed: false })).toBe(
      "not_requested",
    );
    expect(resolveArtifactState({ completed: true, rendered: false, failed: false })).toBe(
      "pending",
    );
    expect(resolveArtifactState({ completed: true, rendered: true, failed: false })).toBe("ready");
    expect(resolveArtifactState({ completed: true, rendered: false, failed: true })).toBe("failed");
    expect(clientFunctions).toContain('artifact_status: "pending"');
    expect(clientFunctions).toContain('event_type: "package.completed"');
    expect(clientFunctions).toContain('await supabaseAdmin.from("na_signatures").insert');
    expect(clientFunctions).toContain('await supabaseAdmin.from("na_events").insert');
  });

  it("requires immutable source-PDF metadata before sealing and renders the source rather than a generated summary", () => {
    expect(serverFunctions).toContain("missing its immutable source PDF");
    expect(serverFunctions).toContain("source_pdf_sha256: templateVersion.source_pdf_sha256");
    expect(renderer).toContain("loadImmutableSourcePdf");
    expect(renderer).toContain("Immutable source PDF hash mismatch");
    expect(renderer).toContain(
      "native-signed/${pkg.client_id}/${packageId}/${snapshot.snapshot_hash}.pdf",
    );
    expect(renderer).toContain('kind: "agreement_pdf"');
  });

  it("makes completed packages immutable while allowing only durable artifact bookkeeping", () => {
    expect(migration).toContain("tg_na_package_protect_completed");
    expect(migration).toContain("artifact_status");
    expect(migration).toContain(
      "REVOKE INSERT, UPDATE, DELETE ON public.na_guest_tokens FROM authenticated",
    );
  });

  it("provides a mobile client signing surface with explicit review, typed/drawn selection, and no ordinary-navigation acceptance", () => {
    expect(signingRoute).toContain("I have reviewed this agreement");
    expect(signingRoute).toContain("Type signature");
    expect(signingRoute).toContain("Draw signature");
    expect(signingRoute).toContain("Open exact agreement PDF");
    expect(signingRoute).toContain("Sign agreement");
    expect(signingRoute).not.toContain("signnow_signing_link");
  });
});
