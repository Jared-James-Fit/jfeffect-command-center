import { describe, expect, it } from "vitest";
import { friendlySignInError } from "@/components/auth/sign-in-form";

describe("friendlySignInError", () => {
  it("turns auth-server jargon into plain English", () => {
    expect(friendlySignInError("Invalid login credentials")).toMatch(/email or password isn't right/i);
    expect(friendlySignInError("Email not confirmed")).toMatch(/confirm your email/i);
    expect(friendlySignInError("Email rate limit exceeded")).toMatch(/too many attempts/i);
    expect(friendlySignInError("TypeError: Failed to fetch")).toMatch(/can't reach the server/i);
  });

  it("passes unknown messages through and never returns empty", () => {
    expect(friendlySignInError("Something specific")).toBe("Something specific");
    expect(friendlySignInError("")).toMatch(/couldn't sign you in/i);
    expect(friendlySignInError(null)).toMatch(/couldn't sign you in/i);
  });
});
