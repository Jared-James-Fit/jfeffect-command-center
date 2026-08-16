import { describe, it, expect } from "vitest";
import {
  resolveAttribution, displaySource, parsePageUrl, labelForFrom,
  DEFAULT_QUICK_APPLY_SOURCE, UNKNOWN_SOURCE,
} from "@/lib/application-attribution";
import { toLeadScore5, leadScoreReason } from "@/lib/lead-score-display";
import {
  isAllowedApplicationEmail, isAllowedApplicationSms, applicationAlertRecipients,
} from "@/lib/application-recipients";

describe("attribution", () => {
  it("defaults Quick Apply to the website online-coaching source", () => {
    const a = resolveAttribution({ default_source_label: DEFAULT_QUICK_APPLY_SOURCE });
    expect(a.source_label).toBe("Website · Online Coaching");
  });

  it("refines the source from an explicit ?from token", () => {
    const a = resolveAttribution({ from: "selkirk", default_source_label: DEFAULT_QUICK_APPLY_SOURCE });
    expect(a.source_label).toBe("Website · Selkirk Personal Training");
  });

  it("title-cases unknown from tokens instead of guessing", () => {
    expect(labelForFrom("spring_promo")).toBe("Spring Promo");
    expect(labelForFrom("")).toBeNull();
    expect(labelForFrom(null)).toBeNull();
  });

  it("extracts path and utm params from the page url", () => {
    const p = parsePageUrl("https://jfeffect.com/coaching/apply?utm_source=ig&utm_medium=bio&utm_campaign=jan");
    expect(p.page_path).toBe("/coaching/apply");
    expect(p.utm_source).toBe("ig");
    expect(p.utm_medium).toBe("bio");
    expect(p.utm_campaign).toBe("jan");
  });

  it("keeps referrer and never invents one", () => {
    expect(resolveAttribution({ referrer: "https://instagram.com/" }).referrer).toBe("https://instagram.com/");
    expect(resolveAttribution({}).referrer).toBeNull();
  });

  it("shows Unknown for legacy rows with no attribution", () => {
    expect(displaySource({})).toBe(UNKNOWN_SOURCE);
    expect(displaySource(null)).toBe(UNKNOWN_SOURCE);
    expect(displaySource({ source_label: "Instagram" })).toBe("Instagram");
  });
});

describe("lead score 1-5 mapping", () => {
  it("maps 0-100 with ceil(score/20), clamped 1..5", () => {
    expect(toLeadScore5(0)).toBe(1);
    expect(toLeadScore5(1)).toBe(1);
    expect(toLeadScore5(20)).toBe(1);
    expect(toLeadScore5(21)).toBe(2);
    expect(toLeadScore5(60)).toBe(3);
    expect(toLeadScore5(61)).toBe(4);
    expect(toLeadScore5(100)).toBe(5);
    expect(toLeadScore5(140)).toBe(5);
    expect(toLeadScore5(-10)).toBe(1);
  });

  it("returns null for non-numeric scores", () => {
    expect(toLeadScore5(null)).toBeNull();
    expect(toLeadScore5("abc")).toBeNull();
  });

  it("derives a deterministic reason from the breakdown", () => {
    const reason = leadScoreReason({
      breakdown: {
        readiness: { score: 20, max: 20, reason: "Fully ready to start" },
        investment: { score: 2, max: 20, reason: "Unsure about investment" },
      },
    });
    expect(reason).toBe("Strongest: Fully ready to start. Weakest: Unsure about investment.");
    expect(leadScoreReason(null)).toBe("No scoring detail recorded.");
  });
});

describe("application recipient allowlist", () => {
  it("contains exactly the configured recipients", () => {
    const { emails, sms } = applicationAlertRecipients();
    expect(emails).toEqual(["jaredjamesfit@gmail.com"]);
    expect(sms).toEqual(["+12042294913", "+12042907443"]);
  });

  it("rejects anything outside the allowlist", () => {
    expect(isAllowedApplicationEmail("jaredjamesfit@gmail.com")).toBe(true);
    expect(isAllowedApplicationEmail("someone@else.com")).toBe(false);
    expect(isAllowedApplicationSms("+12042294913")).toBe(true);
    expect(isAllowedApplicationSms("+15551234567")).toBe(false);
  });
});
