import { describe, expect, it } from "vitest";
import { coachFirstName, renderSmsTemplate, resolveCoachName, smsSender, unknownSmsTags } from "@/lib/sms-identity";
import { buildPaymentSmsBody } from "@/lib/payment-sms.server";

describe("sms identity", () => {
  it("uses the assigned coach's first name, else the fallback", () => {
    expect(coachFirstName({ first_name: null, full_name: "Jared James Fit", status: "Active" })).toBe("Jared");
    expect(resolveCoachName({ first_name: "Sam", full_name: "Sam Lee", archived: true }, "Jared")).toBe("Jared");
    expect(resolveCoachName({ first_name: "Sam", status: "Inactive" }, "Jared")).toBe("Jared");
    expect(resolveCoachName(null, "Jared")).toBe("Jared");
  });

  it("introduces texts as coach from business", () => {
    const t = "Hi {first_name}, this is {coach} from {brand}. Open the app.";
    expect(renderSmsTemplate(t, { first_name: "Bob", coach: "Jared", brand: "JF Effect" }))
      .toBe("Hi Bob, this is Jared from JF Effect. Open the app.");
  });

  it("never leaves a gap when a name is missing", () => {
    const t = "Hi {first_name}, this is {coach} from {brand}.";
    expect(renderSmsTemplate(t, { first_name: "Bob", coach: "", brand: "JF Effect" })).toBe("Hi Bob, this is JF Effect.");
    expect(renderSmsTemplate(t, { first_name: "Bob", coach: "Jared", brand: "" })).toBe("Hi Bob, this is Jared.");
    expect(smsSender("", "")).toBe("your coach");
  });

  it("flags typo'd tags", () => {
    expect(unknownSmsTags("Hi {firstname}, {coach} {setup_link}", ["setup_link"])).toEqual(["firstname"]);
  });

  it("payment text speaks as the coach", () => {
    expect(buildPaymentSmsBody({ firstName: "Bob", coach: "Jared", brand: "JF Effect" }))
      .toMatch(/^Hi Bob, it's Jared from JF Effect\. /);
  });
});
