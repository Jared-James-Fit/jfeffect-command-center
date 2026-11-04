import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RepeatDatePicker } from "@/components/schedule/repeat-date-picker";

const dates = ["2026-11-10", "2026-11-12", "2026-11-17", "2026-11-19"];

describe("picking the dates a weekly repeat books", () => {
  it("shows every date as a tap to book or skip, with Select all and Clear", () => {
    const html = renderToStaticMarkup(
      <RepeatDatePicker dates={dates} skipped={["2026-11-12"]} clashing={["2026-11-17"]} onChange={() => {}} />,
    );
    expect(html).toContain("Booking 3 of 4 dates");
    expect(html).toContain("Select all");
    expect(html).toContain("Clear");
    // the skipped one is off, the rest on; a clashing one is outlined amber
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(3);
    expect((html.match(/aria-pressed="false"/g) ?? []).length).toBe(1);
    expect(html).toContain("border-amber-500");
    expect(html).toContain("Tue, Nov 10");
  });

  it("only the ticked dates are booked and charged for", () => {
    const dialog = readFileSync("src/components/pt-session-dialog.tsx", "utf8");
    expect(dialog).toContain("return repeatDates.filter((d) => !skip.has(d));");
    expect(dialog).toContain('onChange={(skip) => set("_skipDates", skip)}');
    expect(dialog).toContain('"Tick at least one date"');
    // the sale counts the dates being booked
    expect(dialog).toContain("quoteFor(sale, Math.max(previewDates.length, 1), saleProducts, form.title)");
  });
});
