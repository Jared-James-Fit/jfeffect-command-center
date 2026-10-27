import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { answeredQuestions, formAnswerText } from "@/lib/form-answer-text";

describe("submitted form answers in the coach's chat", () => {
  it("reads every answer type as text", () => {
    expect(formAnswerText({ question_id: "q", value_text: "Lose body fat" })).toBe("Lose body fat");
    expect(formAnswerText({ question_id: "q", value_number: 201 })).toBe("201");
    expect(formAnswerText({ question_id: "q", value_number: 0 })).toBe("0");
    expect(formAnswerText({ question_id: "q", value_json: ["Eggs", { label: "Rice" }] })).toBe(
      "Eggs, Rice",
    );
    expect(formAnswerText({ question_id: "q", value_text: "  ", value_json: null })).toBe("");
    expect(formAnswerText(null)).toBe("");
  });

  it("lists answered questions in form order, leaving out blanks, files and videos", () => {
    const rows = answeredQuestions(
      [
        { id: "b", label: "Bodyweight", order_index: 2, question_type: "number" },
        { id: "a", label: "Goal", order_index: 1, question_type: "single_choice" },
        { id: "c", label: "Progress photo", order_index: 3, question_type: "file" },
        { id: "d", label: "Anything else?", order_index: 4, question_type: "long_text" },
      ],
      [
        { question_id: "b", value_number: 201 },
        { question_id: "a", value_text: "Lose body fat" },
        { question_id: "c", value_json: { path: "x.jpg" } },
        { question_id: "d", value_text: "" },
      ],
    );
    expect(rows).toEqual([
      { id: "a", label: "Goal", value: "Lose body fat" },
      { id: "b", label: "Bodyweight", value: "201" },
    ]);
  });

  it("the coach's form card shows the answers and the AI plan, not just a link", () => {
    const card = readFileSync("src/components/messages/messenger-checkin-card.tsx", "utf8");
    expect(card).toContain("<SubmittedFormAnswers");
    expect(card).toContain("answeredQuestions(");
    expect(card).toContain("planMissing(plan)");
    expect(card).not.toContain('"View AI plan"');
  });

  it("submissions link to their client, so lookups through a submission work", () => {
    const file = readdirSync("supabase/migrations").find((f) =>
      f.endsWith("_nf_submissions_client_fk.sql"),
    );
    expect(file).toBeTruthy();
    const sql = readFileSync(`supabase/migrations/${file}`, "utf8");
    expect(sql).toContain("references public.clients(id) on delete cascade");
    expect(sql).toContain("notify pgrst, 'reload schema'");
  });
});
