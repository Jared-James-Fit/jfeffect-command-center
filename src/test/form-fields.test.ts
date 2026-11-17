import { describe, expect, it } from "vitest";
import {
  alignRanking,
  answerAsText,
  eligibleAgeClasses,
  eligibleOptions,
  groupOptions,
  meetItems,
  meetLabel,
  moveRank,
  notCompeting,
  readMeets,
  startGroup,
  toggleMeetLevel,
} from "@/lib/form-fields";
import { formAnswerText, answeredQuestions } from "@/lib/form-answer-text";
import { shouldShowQuestion, type NfQuestion } from "@/lib/native-forms";

const NONE = "None — I don't plan on competing";
let n = 0;
const id = () => `m${++n}`;

describe("competitions field", () => {
  it("None stands alone both ways", () => {
    let m = toggleMeetLevel([], "Provincial Championships", NONE, id);
    m = toggleMeetLevel(m, "National Championships", NONE, id);
    expect(m.map((x) => x.level)).toEqual(["Provincial Championships", "National Championships"]);
    m = toggleMeetLevel(m, NONE, NONE, id);
    expect(m).toEqual([expect.objectContaining({ level: NONE, none: true })]);
    expect(notCompeting(m)).toBe(true);
    m = toggleMeetLevel(m, "Local Meet", NONE, id);
    expect(m.map((x) => x.level)).toEqual(["Local Meet"]);
    // Tapping a picked level takes it off.
    expect(toggleMeetLevel(m, "Local Meet", NONE, id)).toEqual([]);
  });

  it("reads stored meets safely and labels them", () => {
    const stored = [
      { id: "a", level: "Provincial Championships", name: "  MPA Provincials ", date: "2027-06-06", location: "Winnipeg", registered: true },
      { id: "b", level: "National Championships", date: "not a date", qualified: "yes" },
      { junk: true },
    ];
    const meets = readMeets(stored);
    expect(meets).toHaveLength(2);
    expect(meets[0].name).toBe("MPA Provincials");
    expect(meets[1].date).toBeNull();
    expect(meets[1].qualified).toBeNull();
    expect(meetLabel(meets[0])).toMatch(/^MPA Provincials · Jun 6, 2027 · Winnipeg$/);
    expect(meetLabel(meets[1])).toBe("National Championships");
    expect(meetItems(stored).map((i) => i.key)).toEqual(["a", "b"]);
    expect(meetItems([{ id: "z", level: NONE, none: true }])).toEqual([]);
  });
});

describe("ranking", () => {
  const items = [
    { key: "a", label: "Provincials" },
    { key: "b", label: "Nationals" },
    { key: "c", label: "Local meet" },
  ];
  it("keeps the athlete's order, adds new meets at the end, drops removed ones, follows renamed labels", () => {
    const stored = [{ key: "b", label: "Nationals (old)" }, { key: "x", label: "Gone" }, { key: "a", label: "Provincials" }];
    expect(alignRanking(stored, items).map((i) => i.label)).toEqual(["Nationals", "Provincials", "Local meet"]);
    expect(alignRanking(null, items)).toEqual(items);
  });
  it("moves one place at a time, never off either end", () => {
    expect(moveRank(items, 2, -1).map((i) => i.key)).toEqual(["a", "c", "b"]);
    expect(moveRank(items, 0, -1)).toBe(items);
    expect(moveRank(items, 2, 1)).toBe(items);
  });
});

describe("answers as text", () => {
  it("lists, meets and rankings read as words (and follow-up questions can match them)", () => {
    expect(answerAsText({ value_json: ["Yes", "No"] })).toBe("Yes, No");
    expect(answerAsText({ value_json: [{ key: "a", label: "Nationals" }, { key: "b", label: "Provincials" }] })).toBe("Nationals, Provincials");
    expect(answerAsText({ value_json: [{ id: "x", level: NONE, none: true }] })).toBe(NONE);
    expect(answerAsText({ value_text: "", value_number: null, value_json: ["Local Meet"] })).toBe("Local Meet");
    expect(formAnswerText({ question_id: "q", value_json: [{ id: "a", level: "Local Meet", name: "Fall Classic" }] })).toBe("Fall Classic");
  });

  it("a checkbox answer can show or hide a follow-up (it used to be skipped)", () => {
    const meets: Partial<NfQuestion> = { id: "meets" };
    const follow = {
      id: "f",
      conditional_logic: { show_if: [{ question_id: "meets", op: "not_contains", value: "None" }] },
    } as unknown as NfQuestion;
    const ans = (value_json: unknown) => ({ meets: { id: "", submission_id: "", question_id: "meets", value_text: null, value_number: null, value_json } as any });
    expect(shouldShowQuestion(follow, ans([{ id: "a", level: "Local Meet" }]))).toBe(true);
    expect(shouldShowQuestion(follow, ans([{ id: "z", level: NONE, none: true }]))).toBe(false);
    const multi = { id: "m2", conditional_logic: { show_if: [{ question_id: "meets", op: "contains", value: "Local" }] } } as unknown as NfQuestion;
    expect(shouldShowQuestion(multi, ans(["Local Meet", "National Championships"]))).toBe(true);
    void meets;
  });

  it("headings never show as answers", () => {
    expect(
      answeredQuestions(
        [
          { id: "h", label: "Your season", question_type: "info", order_index: 0 },
          { id: "q", label: "Name", question_type: "short_text", order_index: 1 },
        ],
        [{ question_id: "q", value_text: "Marc" }, { question_id: "h", value_text: "x" }],
      ).map((r) => r.label),
    ).toEqual(["Name"]);
  });
});

describe("age and weight classes", () => {
  const AGE = ["SUB-JUNIOR (14–18)", "JUNIOR (19–23)", "OPEN (19–59)", "MASTER 1 (40–49)", "MASTER 2 (50–59)", "MASTER 3 (60–69)", "MASTER 4 (70+)"];
  it("follows the age they turn that year, and classes overlap", () => {
    expect(eligibleOptions(AGE, eligibleAgeClasses("2009-11-30", 2027))).toEqual(["SUB-JUNIOR (14–18)", "OPEN (19–59)"]);
    expect(eligibleOptions(AGE, eligibleAgeClasses("2004-01-02", 2027))).toEqual(["JUNIOR (19–23)", "OPEN (19–59)"]);
    expect(eligibleOptions(AGE, eligibleAgeClasses("1998-05-05", 2027))).toEqual(["OPEN (19–59)"]);
    expect(eligibleOptions(AGE, eligibleAgeClasses("1985-03-03", 2027))).toEqual(["OPEN (19–59)", "MASTER 1 (40–49)"]);
    expect(eligibleOptions(AGE, eligibleAgeClasses("1955-03-03", 2027))).toEqual(["OPEN (19–59)", "MASTER 4 (70+)"]);
    expect(eligibleAgeClasses(null, 2027)).toEqual([]);
    expect(eligibleAgeClasses("2016-01-01", 2027)).toEqual([]);
  });

  it("weight classes group by Men's / Women's with short chips, opening on their sex", () => {
    const opts = ["Men's 59 kg", "Men's 120 kg+", "Women's 43 kg (sub-junior & junior only)", "Women's 84 kg+"];
    const g = groupOptions(opts, ["Men's ", "Women's "]);
    expect(g.map((x) => x.label)).toEqual(["Men", "Women"]);
    expect(g[1].options.map((o) => o.short)).toEqual(["43 kg (sub-junior & junior only)", "84 kg+"]);
    expect(startGroup(["Men's ", "Women's "], null, "female")).toBe("Women's ");
    expect(startGroup(["Men's ", "Women's "], "Men's 59 kg", "female")).toBe("Men's ");
    expect(startGroup(["Men's ", "Women's "], null, null)).toBeNull();
  });
});
