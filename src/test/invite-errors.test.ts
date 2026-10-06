import { describe, expect, it } from "vitest";
import { isAlreadyRegisteredError } from "@/lib/invite-errors";

describe("isAlreadyRegisteredError", () => {
  it("recognises the GoTrue error codes for an existing account", () => {
    expect(isAlreadyRegisteredError({ code: "email_exists", message: "x" })).toBe(true);
    expect(isAlreadyRegisteredError({ code: "user_already_exists", message: "x" })).toBe(true);
  });

  it("recognises the legacy message when no code is set", () => {
    expect(
      isAlreadyRegisteredError({ message: "A user with this email address has already been registered" }),
    ).toBe(true);
  });

  it("does not treat send failures as an existing account", () => {
    expect(isAlreadyRegisteredError({ code: "unexpected_failure", message: "Error sending invite email" })).toBe(false);
    expect(isAlreadyRegisteredError({ code: "over_email_send_rate_limit", message: "email rate limit exceeded" })).toBe(false);
    expect(isAlreadyRegisteredError({ message: "Unable to validate email address: invalid format" })).toBe(false);
  });

  it("is safe on non-error input", () => {
    expect(isAlreadyRegisteredError(null)).toBe(false);
    expect(isAlreadyRegisteredError(undefined)).toBe(false);
    expect(isAlreadyRegisteredError("already registered")).toBe(false);
  });
});
