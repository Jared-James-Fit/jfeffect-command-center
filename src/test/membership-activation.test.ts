import { beforeAll, describe, expect, it } from "vitest";
import {
  codeHash,
  emailProof,
  ipHash,
  newCode,
  proofOk,
  signActivation,
  verifyActivation,
} from "@/lib/membership-activation.server";

const ID = "0f8c2b9e-1a2b-4c3d-8e9f-0123456789ab";

beforeAll(() => {
  process.env.SETUP_INVITE_SECRET = "test-secret-for-activation";
});

describe("activation links", () => {
  it("a signed link names its application until it expires", () => {
    const now = Date.parse("2026-11-19T12:00:00Z");
    const t = signActivation(ID, 30, now);
    expect(verifyActivation(t, now)).toBe(ID);
    expect(verifyActivation(t, now + 29 * 86_400_000)).toBe(ID);
    expect(verifyActivation(t, now + 31 * 86_400_000)).toBeNull();
  });

  it("can't be edited or forged", () => {
    const t = signActivation(ID);
    const [id, exp, sig] = t.split(".");
    expect(verifyActivation(`${id}.${Number(exp) + 999999}.${sig}`)).toBeNull();
    expect(verifyActivation(`0f8c2b9e-1a2b-4c3d-8e9f-0123456789ac.${exp}.${sig}`)).toBeNull();
    expect(verifyActivation(`${id}.${exp}.${"0".repeat(32)}`)).toBeNull();
    expect(verifyActivation("nonsense")).toBeNull();
    expect(verifyActivation(null)).toBeNull();
  });

  it("the email proof only fits its own application and email", () => {
    const p = emailProof(ID, "Devin@Gmail.com");
    expect(proofOk(ID, "devin@gmail.com", p)).toBe(true);
    expect(proofOk(ID, "someone@gmail.com", p)).toBe(false);
    expect(proofOk("0f8c2b9e-1a2b-4c3d-8e9f-0123456789ac", "devin@gmail.com", p)).toBe(false);
    expect(proofOk(ID, "devin@gmail.com", null)).toBe(false);
    expect(proofOk(ID, "devin@gmail.com", "zz")).toBe(false);
  });

  it("codes are 6 digits and only their hash is kept", () => {
    const c = newCode();
    expect(c).toMatch(/^\d{6}$/);
    expect(codeHash(ID, c)).not.toContain(c);
    expect(codeHash(ID, c)).toBe(codeHash(ID, c));
    expect(codeHash(ID, c)).not.toBe(codeHash("0f8c2b9e-1a2b-4c3d-8e9f-0123456789ac", c));
  });

  it("an address is only ever kept as a salted hash", () => {
    expect(ipHash("203.0.113.9")).toMatch(/^[0-9a-f]{32}$/);
    expect(ipHash("203.0.113.9")).not.toContain("203");
    expect(ipHash("")).toBeNull();
  });
});
