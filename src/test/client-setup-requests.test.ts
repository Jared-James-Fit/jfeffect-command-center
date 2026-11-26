import { describe, it, expect } from "vitest";
import { pendingSetupRequests } from "@/lib/client-setup-requests";

const ready = { eligible: true, agreement: { needsSignature: true, requested: false }, goals: { complete: false, requested: false } };
describe("outstanding onboarding requests", () => {
  it("groups only actionable requests", () => expect(pendingSetupRequests(ready)).toEqual(["agreement", "goals"]));
  it("skips existing requests and completed steps", () => expect(pendingSetupRequests({ ...ready, agreement: { needsSignature: true, requested: true }, goals: { complete: true, requested: false } })).toEqual([]));
  it("does not guess when a read fails", () => expect(pendingSetupRequests({ ...ready, agreement: null, goals: null })).toEqual([]));
  it("skips inactive or ineligible accounts", () => expect(pendingSetupRequests({ ...ready, eligible: false })).toEqual([]));
});
