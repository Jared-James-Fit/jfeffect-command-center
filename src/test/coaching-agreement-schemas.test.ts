import { describe, expect, it } from "vitest";
import {
  dateOfBirthSchema,
  phoneSchema,
  signPayloadSchema,
} from "@/lib/coaching-agreement/schemas";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const validDetails = {
  phone: "204 555 0123",
  dateOfBirth: "1990-05-05",
  address: {
    street: "1 Portage Ave",
    city: "Winnipeg",
    province: "MB",
    postalCode: "R3B 0A1",
    country: "Canada",
  },
  emergencyContact1: { name: "Mom Doe", phone: "204-555-0199" },
  emergencyContact2: null,
  payor: null,
};

const valid = {
  idempotencyKey: "3d8f0c3e-7c63-4a4e-9f0a-1a2b3c4d5e6f",
  contentHash: "a".repeat(64),
  typedLegalName: "Jane Doe",
  signatureMethod: "drawn" as const,
  signatureImage: png,
  details: validDetails,
  acknowledged: ["money", "risk", "health", "disputes", "review"],
  optionalConsents: { testimonial_use: true },
  guardian: null,
  review: { sectionsOpened: 4, reviewSeconds: 75, scrolledToEnd: true },
};

describe("sign payload validation", () => {
  it("accepts a complete payload", () => {
    expect(signPayloadSchema.safeParse(valid).success).toBe(true);
  });

  it("requires a drawn signature to include an image", () => {
    const r = signPayloadSchema.safeParse({ ...valid, signatureImage: null });
    expect(r.success).toBe(false);
  });

  it("accepts a typed signature without an image", () => {
    expect(
      signPayloadSchema.safeParse({ ...valid, signatureMethod: "typed", signatureImage: null })
        .success,
    ).toBe(true);
  });

  it("rejects signature data that isn't a PNG data URL", () => {
    expect(
      signPayloadSchema.safeParse({ ...valid, signatureImage: "https://evil.example/x.png" })
        .success,
    ).toBe(false);
    expect(
      signPayloadSchema.safeParse({
        ...valid,
        signatureImage: "data:text/html;base64,PHNjcmlwdD4=",
      }).success,
    ).toBe(false);
  });

  it("rejects an oversized signature image", () => {
    const huge = "data:image/png;base64," + "A".repeat(400_001);
    expect(signPayloadSchema.safeParse({ ...valid, signatureImage: huge }).success).toBe(false);
  });

  it("rejects a too-short or number-only legal name", () => {
    expect(signPayloadSchema.safeParse({ ...valid, typedLegalName: "J" }).success).toBe(false);
    expect(signPayloadSchema.safeParse({ ...valid, typedLegalName: "12345" }).success).toBe(false);
  });

  it("rejects a malformed content hash or idempotency key", () => {
    expect(signPayloadSchema.safeParse({ ...valid, contentHash: "nope" }).success).toBe(false);
    expect(signPayloadSchema.safeParse({ ...valid, idempotencyKey: "not-a-uuid" }).success).toBe(
      false,
    );
  });

  it("requires a payor to be confirmed when one is provided", () => {
    const payor = {
      name: "Pat Payor",
      relationship: "Father",
      phone: "204 555 0111",
      email: "pat@example.com",
    };
    expect(
      signPayloadSchema.safeParse({
        ...valid,
        details: { ...validDetails, payor: { ...payor, confirmed: true } },
      }).success,
    ).toBe(true);
    expect(
      signPayloadSchema.safeParse({
        ...valid,
        details: { ...validDetails, payor: { ...payor, confirmed: false } },
      }).success,
    ).toBe(false);
  });

  it("requires a guardian to acknowledge the statement", () => {
    const guardian = {
      fullName: "Dee Guardian",
      relationship: "Mother",
      phone: "204 555 0112",
      signatureMethod: "typed" as const,
      signatureImage: null,
    };
    expect(
      signPayloadSchema.safeParse({ ...valid, guardian: { ...guardian, acknowledged: true } })
        .success,
    ).toBe(true);
    expect(
      signPayloadSchema.safeParse({ ...valid, guardian: { ...guardian, acknowledged: false } })
        .success,
    ).toBe(false);
  });
});

describe("field validation", () => {
  it("accepts international phone formats and rejects too-short numbers", () => {
    expect(phoneSchema.safeParse("+44 20 7946 0958").success).toBe(true);
    expect(phoneSchema.safeParse("(204) 555-0123").success).toBe(true);
    expect(phoneSchema.safeParse("12345").success).toBe(false);
    expect(phoneSchema.safeParse("1".repeat(16)).success).toBe(false);
  });

  it("rejects impossible, future and absurd dates of birth", () => {
    expect(dateOfBirthSchema.safeParse("1990-05-05").success).toBe(true);
    expect(dateOfBirthSchema.safeParse("2026-02-31").success).toBe(false);
    expect(dateOfBirthSchema.safeParse("2999-01-01").success).toBe(false);
    expect(dateOfBirthSchema.safeParse("1800-01-01").success).toBe(false);
    expect(dateOfBirthSchema.safeParse("05/05/1990").success).toBe(false);
  });
});
