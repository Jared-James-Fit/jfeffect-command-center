// Vitest setup — guarantees no real network / Stripe / Twilio / email calls during tests.
import { afterEach, vi } from "vitest";

// Mark test environment so app code can refuse real-side-effect paths if it wants.
process.env.NODE_ENV = "test";
process.env.JF_TEST_MODE = "1";

// Fail loudly if any test attempts a real fetch — every test must mock it explicitly.
const realFetch = globalThis.fetch;
globalThis.fetch = vi.fn(async (input: any) => {
  throw new Error(
    `Network fetch attempted during tests: ${typeof input === "string" ? input : (input as Request).url}. ` +
      `Mock this call explicitly inside the test.`,
  );
}) as any;

afterEach(() => {
  // Reset all vi.fn() mocks between tests but keep the fetch guard installed.
  vi.restoreAllMocks();
  globalThis.fetch = vi.fn(async (input: any) => {
    throw new Error(
      `Network fetch attempted during tests: ${typeof input === "string" ? input : (input as Request).url}.`,
    );
  }) as any;
});

// Suppress unhandled-rejection noise from intentional rejection tests.
process.on("unhandledRejection", () => {});

export { realFetch };