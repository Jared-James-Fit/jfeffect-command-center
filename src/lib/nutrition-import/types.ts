/**
 * A meal plan brought into the Nutrition Studio from somewhere else: imported
 * from someone's own file or text, or drafted by Cleo from a member's answers
 * (nutrition_imports, 20270508091000_nutrition_imports.sql). Pure types shared
 * by the phone, the server and the tests.
 */

export type MealImportKind = "import" | "create";

export type MealSourceKind = "text" | "csv" | "xlsx" | "docx" | "pdf" | "image" | "answers";

export type MealImportStatus = "pending" | "reading" | "ready" | "failed" | "saved" | "discarded";

/** Something the person should look at before editing the plan: `check` needs a look, `info` is context. */
export type MealFlag = {
  level: "check" | "info";
  code:
    | "not_in_file"
    | "food_not_in_file"
    | "unsure"
    | "totals"
    | "no_macros"
    | "unchecked"
    | "hard_to_find"
    | "allergen"
    | "prep"
    | "coverage";
  text: string;
  /** The day it's about ("Training Day"), when it's about one. */
  day?: string;
};

/**
 * What a read or a draft came back as: the plan in the app's paste format
 * (the text every reader understands, meal-plan-parse.ts) and its flags. For a
 * PDF or photos, `transcript` is the text the read saw in the file, which the
 * plan is checked against and the person can look at.
 */
export type MealImportResult = {
  text: string;
  flags: MealFlag[];
  transcript?: string | null;
};
