import { describe, it, expect } from "vitest";
import {
  leadStage, isClosedStage, displayLeadSource, displayLeadName, leadScoreDisplay,
  nextActionDisplay, lastMeaningfulContact, stageCounts, SOURCE_UNKNOWN, NO_FOLLOW_UP,
} from "@/lib/crm-display";
import {
  coachingStatus, riskAlerts, topRiskAlert, showPtWidgets, recurringPaymentDisplay,
  NO_RECURRING_PAYMENT,
} from "@/lib/coaching-management";

describe("lead stage normalization", () => {
  it("maps canonical lifecycle stages to one displayed stage", () => {
    expect(leadStage("lead").label).toBe("New");
    expect(leadStage("applicant").label).toBe("New");
    expect(leadStage("call_booked").label).toBe("Contacted");
    expect(leadStage("follow_up").label).toBe("Contacted");
    expect(leadStage("qualified").label).toBe("Qualified");
    expect(leadStage("offer_sent").label).toBe("Offer Sent");
    expect(leadStage("active_client").label).toBe("Won");
    expect(leadStage("disqualified").label).toBe("Lost");
  });
  it("falls back to New for unknown/empty stages", () => {
    expect(leadStage(null).key).toBe("new");
    expect(leadStage("something_else").key).toBe("new");
  });
  it("treats won and lost as closed", () => {
    expect(isClosedStage("won")).toBe(true);
    expect(isClosedStage("active_client")).toBe(true);
    expect(isClosedStage("lost")).toBe(true);
    expect(isClosedStage("qualified")).toBe(false);
  });
  it("counts stages", () => {
    const c = stageCounts([{ lifecycle_stage: "lead" }, { lifecycle_stage: "won" }, { lifecycle_stage: "applicant" }]);
    expect(c.new).toBe(2);
    expect(c.won).toBe(1);
  });
});

describe("source and name fallbacks", () => {
  it("never renders an empty source", () => {
    expect(displayLeadSource(null)).toBe(SOURCE_UNKNOWN);
    expect(displayLeadSource("  ")).toBe(SOURCE_UNKNOWN);
    expect(displayLeadSource("Instagram")).toBe("Instagram");
  });
  it("composes a name from available parts", () => {
    expect(displayLeadName({ full_name: "Jo Smith" })).toBe("Jo Smith");
    expect(displayLeadName({ first_name: "Jo", last_name: "Smith" })).toBe("Jo Smith");
    expect(displayLeadName({ email: "jo@x.com" })).toBe("jo@x.com");
    expect(displayLeadName({})).toBe("Unnamed lead");
  });
});

describe("lead score display", () => {
  it("maps 0-100 to 1-5 without mutating the source", () => {
    expect(leadScoreDisplay(88).label).toBe("5/5");
    expect(leadScoreDisplay(20).label).toBe("1/5");
    expect(leadScoreDisplay(null).label).toBe("No score");
  });
  it("gives a deterministic reason when a breakdown exists", () => {
    const r = leadScoreDisplay(60, {
      breakdown: {
        budget: { score: 10, max: 10, reason: "budget aligned" },
        timeline: { score: 1, max: 10, reason: "no timeline given" },
      },
    });
    expect(r.reason).toContain("budget aligned");
    expect(r.reason).toContain("no timeline given");
  });
});

describe("next action projection", () => {
  it("prefers the internal open follow-up", () => {
    const n = nextActionDisplay({
      followups: [
        { status: "completed", reason: "old", due_date: "2026-01-01" },
        { status: "open", reason: "Call back", due_date: "2026-03-02" },
        { status: "open", reason: "Later", due_date: "2026-04-02" },
      ],
      next_follow_up_at: "2026-09-09T00:00:00Z",
    });
    expect(n.label).toBe("Call back");
    expect(n.dueAt).toBe("2026-03-02");
  });
  it("falls back to the legacy column, then to an explicit empty state", () => {
    expect(nextActionDisplay({ next_follow_up_at: "2026-03-02T00:00:00Z" }).isSet).toBe(true);
    expect(nextActionDisplay({}).label).toBe(NO_FOLLOW_UP);
  });
});

describe("last meaningful contact", () => {
  it("prefers contact log over application date", () => {
    expect(lastMeaningfulContact({ last_contacted_at: "2026-02-01", applied_at: "2026-01-01" }).kind).toBe("contacted");
    expect(lastMeaningfulContact({ applied_at: "2026-01-01" }).kind).toBe("applied");
    expect(lastMeaningfulContact({}).kind).toBe("none");
  });
});

describe("coaching management mapping", () => {
  it("maps canonical statuses only", () => {
    expect(coachingStatus({ client_status: "paused" }).label).toBe("Paused");
    expect(coachingStatus({ client_status: "cancelled" }).label).toBe("Ended");
    expect(coachingStatus({ client_status: "cancelling" }).label).toBe("Cancelling");
    expect(coachingStatus({ client_status: "active" }).label).toBe("Active");
    expect(coachingStatus({ f_new_client: true, f_needs_setup: true }).label).toBe("Onboarding");
  });
  it("marks active clients at risk only on deterministic signals", () => {
    expect(coachingStatus({ client_status: "active", f_payment_issue: true }).label).toBe("At Risk");
    expect(coachingStatus({ client_status: "active", days_since_workout: 4 }).label).toBe("Active");
  });
  it("orders risk signals by priority and surfaces one alert", () => {
    const input = { f_payment_issue: true, days_since_check_in: 30, missed_workouts_count: 5, days_since_workout: 20 };
    expect(riskAlerts(input).map((a) => a.key)).toEqual([
      "failed_payment", "no_check_in", "missed_workouts", "no_workout",
    ]);
    expect(topRiskAlert(input)?.key).toBe("failed_payment");
    expect(topRiskAlert({ days_since_workout: 3 })).toBeNull();
  });
  it("hides PT and recurring-payment widgets without a real source", () => {
    expect(showPtWidgets({ coaching_type: "Online" })).toBe(false);
    expect(showPtWidgets({ coaching_type: "Hybrid PT" })).toBe(true);
    expect(showPtWidgets({ coaching_type: "Online", pt_sessions_remaining: 0 })).toBe(true);
    expect(recurringPaymentDisplay({}).label).toBe(NO_RECURRING_PAYMENT);
    expect(recurringPaymentDisplay({ next_payment_at: "2026-04-01" }).hasPayment).toBe(true);
  });
});
