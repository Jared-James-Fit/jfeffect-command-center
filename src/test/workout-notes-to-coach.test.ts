import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { matchesNotesFilter, painAreaLabel, painLine, painSeverityLabel } from "@/lib/workout-notes";
import { messageAction } from "@/lib/push/notification-payload";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261128100000_workout_notes_to_coach.sql");

describe("pain reads like a coach would say it", () => {
  it("side and both sides, from the review's stored area", () => {
    expect(painAreaLabel("Knee (L)")).toBe("Left knee");
    expect(painAreaLabel("Shoulder (R)")).toBe("Right shoulder");
    expect(painAreaLabel("Hip (L), Hip (R)")).toBe("Both hips");
    expect(painAreaLabel("Low back")).toBe("Low back");
    expect(painAreaLabel("General")).toBe("General");
  });
  it("the review's own severity words", () => {
    expect([painSeverityLabel(3), painSeverityLabel(5), painSeverityLabel(8)]).toEqual(["Mild", "Moderate", "Sharp"]);
    expect(painLine({ area: "Knee (L)", level: 5 })).toBe("Left knee · Moderate (5/10)");
  });
  it("the log's filters", () => {
    expect(matchesNotesFilter({ source: "review", pain: { area: "Knee", level: 5 } }, "pain")).toBe(true);
    expect(matchesNotesFilter({ source: "exercise", pain: null }, "review")).toBe(false);
    expect(matchesNotesFilter({ source: "exercise", pain: null }, "exercise")).toBe(true);
  });
});

describe("notes reach the coach in Messages (DB triggers)", () => {
  it("only a coaching client, writing it themselves: never a member, never the coach in View as client", () => {
    expect(sql).toContain("AND c.service_tier = 'coaching'");
    expect(sql).toContain("AND c.user_id = (SELECT auth.uid())");
    expect(sql).toContain("BEFORE INSERT OR UPDATE OF client_note, pain, pain_area, pain_level ON public.pl_workout_feedback");
    expect(sql).toContain("BEFORE INSERT OR UPDATE OF content ON public.pl_exercise_notes");
  });
  it("one card from the athlete; edits show on it (never rewrites the message), a later change or new pain posts a new one", () => {
    expect(sql).toContain("'kind', 'workout_note'");
    expect(sql).toContain("'client', v_body");
    expect(sql).not.toMatch(/UPDATE public\.messages/);
    expect(sql).toContain("m.created_at > now() - interval '10 minutes'");
    expect(sql).toContain("v_pain_added := v_pain AND TG_OP = 'UPDATE' AND NOT coalesce(OLD.pain, false);");
  });
  it("the coach's log: staff who can see the client, or the client", () => {
    expect(sql).toContain("public.has_role(uid, 'admin') OR public.is_assigned_coach(_client_id)");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.client_workout_notes(uuid, int) FROM PUBLIC, anon;");
  });
  it("the push says what it is, never what it says", () => {
    expect(messageAction([{ kind: "workout_note", pain: { area: "Knee", level: 5 } } as any], true)).toBe("flagged pain in a workout");
    expect(messageAction([{ kind: "workout_note" }], true)).toBe("sent you a workout note");
  });
});

describe("the card and where the log lives", () => {
  const thread = read("src/components/message-thread.tsx");
  const card = read("src/components/messages/workout-note-card.tsx");
  it("the chat shows the card (its text is for previews)", () => {
    expect(thread).toContain('if (att.kind === "workout_note" && message) {');
    expect(thread).toContain('a?.kind === "session_request" || a?.kind === "workout_note"');
    // live note, a newer card takes over, removed shows as removed
    expect(card).toContain("const superseded = !!live?.latestMessageId && live.latestMessageId !== messageId;");
    expect(card).toContain("They removed this note.");
    expect(card).toContain("Sent to your coach");
  });
  it("Notes in the coach's chat header, and the same log on the profile (Training)", () => {
    expect(read("src/route-pages/_authenticated/admin/messages.tsx")).toContain("<ClientNotesSheet clientId={notesOpen ? selected.id : null}");
    expect(read("src/route-pages/_authenticated/admin/clients.$id.tsx")).toContain("<ClientTrainingTab clientId={id}");
    expect(read("src/components/clients/client-training-tab.tsx")).toContain("<ClientNotesCard clientId={clientId} name={name} />");
  });
});

describe("the athlete knows it goes to their coach (members never hear about a coach)", () => {
  const review = read("src/components/workout/shared/workout-review-editor.tsx");
  const day = read("src/components/workout-day/WorkoutDayView.tsx");
  it("review: says so, pushes the coach, not in View as client", () => {
    expect(review).toContain("const coached = hasCoach && !isSelfServe;");
    expect(review).toContain('"Goes to your coach in Messages."');
    expect(review).toContain("const toCoach = coached && !actAsClientId && !!res?.coachMessageId;");
    expect(review).toContain('coached ? "Anything your coach should know?" : "Anything to remember about today?"');
  });
  it("exercise note: says so and pushes the coach", () => {
    expect(day).toContain("const toCoach = !isSelfServe && !isImpersonating;");
    expect(day).toContain("Goes to your coach in Messages.");
    expect(day).toContain("await pushWorkoutNote(data?.coach_message_id ?? null);");
  });
});

describe("no notifications bell", () => {
  it("not in page headers, not on Crew", () => {
    expect(read("src/components/app-shell.tsx")).not.toContain("<NotificationBell");
    expect(read("src/components/community/community-screen.tsx")).not.toContain("NotificationBell");
  });
});
