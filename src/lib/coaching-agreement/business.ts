/**
 * Who the business is. Kept apart from the agreement text so small, always-loaded code (the
 * coach-name rules, the signed-copy viewer) can use it without pulling the whole text in.
 * These values are part of the agreement content, so changing any of them changes the text.
 */
export const COACH = {
  business: "JF Effect",
  operator: "Jared McIntyre",
  location: "Winnipeg, Manitoba, Canada",
  email: "jaredjamesfit@gmail.com",
  timezone: "America/Winnipeg",
} as const;
