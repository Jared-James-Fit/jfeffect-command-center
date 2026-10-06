/**
 * Validation shared by the signing form (instant feedback) and the server (the
 * authority). The server never trusts the browser: it re-validates everything here
 * and takes acknowledgement wording, version and hash from its own copy of the
 * agreement, not from the request.
 */
import { z } from "zod";
import { ageOnDate } from "./rules";

const digits = (value: string) => value.replace(/\D/g, "");

export const phoneSchema = z
  .string()
  .trim()
  .max(40)
  .refine((v) => {
    const n = digits(v).length;
    return n >= 7 && n <= 15;
  }, "Enter a valid phone number");

const nameSchema = (label: string) =>
  z
    .string()
    .trim()
    .min(2, `${label} is required`)
    .max(120, `${label} is too long`)
    .refine((v) => /\p{L}/u.test(v), `${label} must contain letters`);

export const dateOfBirthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter your date of birth")
  .refine((v) => ageOnDate(v, new Date()) !== null, "Enter a valid date of birth")
  .refine((v) => (ageOnDate(v, new Date()) ?? -1) >= 0, "Date of birth can't be in the future")
  .refine((v) => (ageOnDate(v, new Date()) ?? 200) <= 110, "Enter a valid date of birth");

export const addressSchema = z.object({
  street: z.string().trim().min(3, "Street address is required").max(200),
  city: z.string().trim().min(2, "City is required").max(100),
  province: z.string().trim().min(2, "Province or state is required").max(100),
  postalCode: z.string().trim().min(3, "Postal or zip code is required").max(20),
  country: z.string().trim().min(2, "Country is required").max(100),
});

export const emergencyContactSchema = z.object({
  name: nameSchema("Contact name"),
  phone: phoneSchema,
});

export const payorSchema = z.object({
  name: nameSchema("Payor name"),
  relationship: z.string().trim().min(2, "Relationship is required").max(80),
  phone: phoneSchema,
  email: z.string().trim().email("Enter the payor's email").max(200),
  /** The client confirms the payor has been given the chance to read the agreement. */
  confirmed: z.literal(true, { message: "Confirm the payor has been given the agreement" }),
});

export const detailsSchema = z.object({
  phone: phoneSchema,
  dateOfBirth: dateOfBirthSchema,
  address: addressSchema,
  emergencyContact1: emergencyContactSchema,
  emergencyContact2: emergencyContactSchema.nullable().default(null),
  payor: payorSchema.nullable().default(null),
});
export type AgreementDetails = z.infer<typeof detailsSchema>;

/** PNG data URL from the signature pad. ~1.3 chars per byte, so 400k chars is ~300KB of image. */
export const signatureImageSchema = z
  .string()
  .max(400_000, "Signature is too large")
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "Signature is not a valid image");

export const guardianSchema = z.object({
  fullName: nameSchema("Parent or guardian name"),
  relationship: z.string().trim().min(2, "Relationship is required").max(80),
  phone: phoneSchema,
  signatureMethod: z.enum(["drawn", "typed"]),
  signatureImage: signatureImageSchema.nullable(),
  /** The parent or guardian ticked the guardian statement. */
  acknowledged: z.literal(true, { message: "The parent or guardian must confirm the statement" }),
});
export type GuardianDetails = z.infer<typeof guardianSchema>;

export const reviewStatsSchema = z.object({
  sectionsOpened: z.number().int().min(0).max(200),
  reviewSeconds: z.number().int().min(0).max(86_400),
  scrolledToEnd: z.boolean(),
});

export const signPayloadSchema = z
  .object({
    /** Fresh UUID per signing attempt; makes a double tap or retry idempotent. */
    idempotencyKey: z.string().uuid(),
    /** Hash of the agreement the client actually reviewed; must equal the server's current hash. */
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    typedLegalName: z
      .string()
      .trim()
      .min(3, "Type your full legal name")
      .max(120)
      .refine((v) => /\p{L}/u.test(v), "Your name must contain letters"),
    signatureMethod: z.enum(["drawn", "typed"]),
    signatureImage: signatureImageSchema.nullable(),
    details: detailsSchema,
    /** Ids of acknowledgements ticked. The server checks all required ones are present. */
    acknowledged: z.array(z.string().min(1).max(40)).max(20),
    optionalConsents: z.record(z.string().max(40), z.boolean()).default({}),
    guardian: guardianSchema.nullable().default(null),
    review: reviewStatsSchema,
    timezone: z.string().max(64).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.signatureMethod === "drawn" && !value.signatureImage) {
      ctx.addIssue({ code: "custom", path: ["signatureImage"], message: "Draw your signature" });
    }
  });
export type SignPayload = z.infer<typeof signPayloadSchema>;

/** Admin: "send another one". */
export const requestResignSchema = z.object({
  clientId: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
});

export const setExemptionSchema = z.object({
  clientId: z.string().uuid(),
  kind: z.enum(["offline_signed", "not_required"]),
  note: z.string().trim().max(500).optional(),
});

export const clientIdSchema = z.object({ clientId: z.string().uuid() });
export const signatureIdSchema = z.object({ signatureId: z.string().uuid() });
