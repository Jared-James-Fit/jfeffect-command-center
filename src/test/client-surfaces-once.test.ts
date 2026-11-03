import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(f, "utf8");

describe("client Home asks for each thing once", () => {
  const home = read("src/routes/_authenticated/portal/index.tsx");

  it("the Goals & Setup prompt opens at most once per app launch, never over another popup", () => {
    expect(home).toContain("const goalsPromptShownFor = new Set<string>();");
    expect(home).toContain("if (uiIsClear()) {");
    expect(home).toContain('[role="dialog"][data-state="open"]');
  });

  it("no Updating… pill: only offline and a failed refresh are worth saying", () => {
    const pill = read("src/components/portal/dashboard-refresh-indicator.tsx");
    expect(pill).not.toContain("Updating…");
    expect(pill).toContain("Offline mode");
    expect(pill).toContain("Showing saved data");
  });

  it("the Sessions card is the package's credits; the next session is the calendar card's", () => {
    const card = read("src/components/portal/sessions-card.tsx");
    expect(card).not.toContain("Next:");
    expect(card).not.toContain('to="/portal/calendar"');
    expect(card).toContain("available");
    expect(home).toContain("<SessionsCard clientId={client.id} />");
  });

  it("Water: one History that opens the water log in place, three drinks inline, no seconds", () => {
    const water = read("src/components/home/home-water-card.tsx");
    expect(water).toContain("<WaterHistorySheet");
    expect(water).not.toContain('action: "history"');
    expect(water).toContain("const INLINE_DRINKS = 3;");
    expect(water).toContain('format(new Date(entry.entry_at), "h:mm a")');
    expect(water).not.toContain("h:mm:ss");
    // the same header as Bodyweight and Progress (AGENTS: matching headers)
    for (const f of ["src/components/home/home-water-card.tsx", "src/components/portal/bodyweight-summary-card.tsx", "src/components/progress/progress-summary-card.tsx"]) {
      expect(read(f), f).toContain("<HomeCardHeader");
    }
  });
});

describe("client Nutrition: every tool once", () => {
  const page = read("src/routes/_authenticated/portal/nutrition-targets.tsx");
  it("one Meal Plan PDF, one Log Food, the Cookbook a tool tile", () => {
    expect(page.match(/onClick=\{handleDownload\}/g)?.length).toBe(1);
    expect(page.match(/<LogFoodToolButton/g)?.length).toBe(1);
    expect(read("src/components/nutrition/TodaysIntakeCard.tsx")).not.toContain("Log Food\n        </Button>");
    expect(page).toContain('<CookbookToolTile viewer="client" />');
    expect(page).not.toContain("<CookbookEntryCard");
  });
  it("says less: no page subtitle, targets name only the day and phase, tiles are icon + name", () => {
    expect(page).toContain('<PageHeader title="Nutrition" />');
    expect(page).toContain('{phase ? ` · ${phase}` : ""}');
    expect(page).not.toContain("plan.structure].filter(Boolean)");
    const tile = read("src/components/nutrition/tool-tile.tsx");
    expect(tile).not.toMatch(/export type TileProps = \{[^}]*hint/);
    expect(read("src/components/nutrition/NutritionToolsCard.tsx")).not.toContain("Everything you need, one tap away");
    // "Your macros add up to…" only when they're more than 5% off the target
    expect(read("src/components/nutrition/MacroTargetsChart.tsx")).toContain("Math.abs(target - split.kcal) > target * 0.05");
  });
  it("tools are neutral: no gradient or tinted entry cards", () => {
    for (const f of ["src/components/nutrition/tool-tile.tsx", "src/components/nutrition/GroceryListSheet.tsx", "src/components/nutrition/CookbookSheet.tsx"]) {
      const src = read(f);
      expect(src, f).not.toContain("bg-gradient-to");
      expect(src, f).not.toContain("from-primary/10");
    }
  });
});

describe("client Account: a short settings list", () => {
  const account = read("src/routes/_authenticated/portal/account.tsx");
  it("sections are rows that open in place; no sticky jump bar", () => {
    expect(account).toContain('<Accordion type="multiple" value={open} onValueChange={setOpen}');
    expect(account).not.toContain('aria-label="Account sections"');
    expect(account).toContain('<SettingsSection id="delete-account" icon={Trash2} title="Delete account" destructive>');
  });
  it("a link to a section opens it (the legal notice's #legal, the old anchors)", () => {
    expect(account).toContain('legal: "legal",');
    expect(account).toContain('"legal-safety": "legal",');
    expect(account).toContain('"training-schedule": "units",');
    expect(account).toContain("const id = accountSectionFromHash(hash);");
    expect(read("src/components/legal/legal-notice.tsx")).toContain('<Link to="/portal/account" hash="legal"');
  });
  it("Goals & Setup is a coaching client's only (the coach's onboarding)", () => {
    expect(account).toContain('const goalsOn = useEntitlement("goals_setup");');
    expect(account).toContain("{goalsOn && client && (");
  });
});

describe("coach chat header", () => {
  const page = read("src/routes/_authenticated/portal/messages.tsx");
  it("Call is one neutral tap; Text and Mark as unread share one ⋯ menu", () => {
    expect(page).toContain("<DropdownMenu>");
    expect(page).toContain('aria-label="More options"');
    expect(page).toContain("Mark as unread");
    expect(page).not.toContain("bg-emerald-500/10 text-emerald-600");
    expect(page).not.toContain("border-primary/40 bg-primary/10 text-primary");
  });
});

describe("asking for a PT session is the coaching layer", () => {
  it("Home's calendar card and the Calendar page offer Request a session only with pt_sessions; members book", () => {
    const card = readFileSync("src/components/home/upcoming-schedule-card.tsx", "utf8");
    expect(card).toContain('const canRequest = useEntitlement("pt_sessions");');
    expect(card).toContain("{links && (singleBook || (bookable.length > 1 && !pov.viewAsClientId) || canRequest) && (");
    expect(card).toContain("{links && canRequest && (");
    const cal = readFileSync("src/routes/_authenticated/portal/calendar.tsx", "utf8");
    expect(cal).toContain('const canRequest = useEntitlement("pt_sessions");');
    expect(cal).toContain(") : <ClientBookCard />)}");
  });
});
