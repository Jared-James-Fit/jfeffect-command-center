import { describe, expect, it } from "vitest";
import { ACTION_MIN_MS, PROBLEM_MIN_MS, ROUTINE_MS, isRepeat, messageKey, shapeToast, toastFeedback } from "@/lib/toast-policy";

describe("toast policy", () => {
  it("routine success is short and loses its description", () => {
    const o = shapeToast("success", { description: "Only you can see it." });
    expect(o.duration).toBe(ROUTINE_MS);
    expect(o.description).toBeUndefined();
  });
  it("Undo stays long enough to act", () => {
    expect(shapeToast("success", { action: { label: "Undo", onClick() {} }, duration: 3000 }).duration).toBe(ACTION_MIN_MS);
    expect(shapeToast("message", { action: {} }).duration).toBe(ACTION_MIN_MS);
  });
  it("errors keep their description and stay up", () => {
    const o = shapeToast("error", { description: "Check your connection." });
    expect(o.description).toBe("Check your connection.");
    expect(o.duration).toBe(PROBLEM_MIN_MS);
  });
  it("loading never times out and keeps a longer caller duration", () => {
    expect(shapeToast("loading").duration).toBe(Infinity);
    expect(shapeToast("error", { duration: 10000 }).duration).toBe(10000);
  });
  it("dedupes the same message inside the window only", () => {
    const k = messageKey("success", " Workout saved ");
    expect(k).toBe("success:workout saved");
    expect(isRepeat(k, { key: k, at: 1000 }, 1800)).toBe(true);
    expect(isRepeat(k, { key: k, at: 1000 }, 3000)).toBe(false);
    expect(isRepeat(messageKey("error", "Workout saved"), { key: k, at: 1000 }, 1100)).toBe(false);
    expect(messageKey("success", {})).toBeNull();
  });
  it("haptics: light for success, none for info", () => {
    expect(toastFeedback("success")).toBe("complete");
    expect(toastFeedback("info")).toBeNull();
    expect(toastFeedback("error")).toBe("error");
  });
});
