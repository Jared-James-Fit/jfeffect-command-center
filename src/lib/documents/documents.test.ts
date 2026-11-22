import { describe, expect, it } from "vitest";
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_BYTES,
  binLine,
  canEditDocument,
  categoriesFor,
  categoryChips,
  checkFile,
  cleanTags,
  documentDate,
  documentPath,
  downloadName,
  filterDocuments,
  fileTypeOf,
  formatBytes,
  guessCategory,
  isOwnDocumentPath,
  kindOfMime,
  matchesSearch,
  metaLine,
  parseTagInput,
  safeFileName,
  shareWords,
  sortDocuments,
  titleFromFileName,
  uploadPrivacyLine,
  visibilityOptions,
  type DocumentRow,
} from "./documents";
import { readFileSync } from "node:fs";

const ME = "00000000-0000-4000-8000-0000000000d1";
const ID = "11111111-1111-4111-8111-111111111101";

function doc(p: Partial<DocumentRow>): DocumentRow {
  return {
    id: p.id ?? crypto.randomUUID(),
    owner_user_id: ME,
    client_id: null,
    category: "other",
    title: "Doc",
    tags: [],
    file_path: `${ME}/${ID}-doc.pdf`,
    mime: "application/pdf",
    bytes: 1000,
    source: "upload",
    linked_kind: null,
    linked_id: null,
    visibility: "private",
    created_at: "2026-11-01T12:00:00Z",
    updated_at: "2026-11-01T12:00:00Z",
    deleted_at: null,
    ...p,
  };
}

describe("files the library takes", () => {
  it("reads a file's type from its extension first", () => {
    expect(fileTypeOf("Meet plan.PDF")?.mime).toBe("application/pdf");
    expect(fileTypeOf("plan.csv", "application/vnd.ms-excel")?.mime).toBe("text/csv");
    expect(fileTypeOf("macros.xlsx", "")?.kind).toBe("sheet");
    expect(fileTypeOf("IMG_0001.HEIC")?.mime).toBe("image/heic");
  });
  it("falls back to what the picker said when there's no known extension", () => {
    expect(fileTypeOf("scan", "image/jpeg")?.ext).toBe("jpg");
    expect(fileTypeOf("notes", "text/plain; charset=utf-8")?.mime).toBe("text/plain");
  });
  it("refuses everything else", () => {
    expect(fileTypeOf("clip.mov", "video/quicktime")).toBeNull();
    expect(fileTypeOf("old.doc", "application/msword")).toBeNull();
    expect(fileTypeOf("macro.xlsm")).toBeNull();
    const c = checkFile({ name: "song.mp3", size: 10, type: "audio/mpeg" });
    expect(c.ok).toBe(false);
  });
  it("checks the size before anything uploads", () => {
    expect(checkFile({ name: "a.pdf", size: 0 }).ok).toBe(false);
    expect(checkFile({ name: "a.pdf", size: MAX_DOCUMENT_BYTES }).ok).toBe(true);
    const big = checkFile({ name: "a.pdf", size: MAX_DOCUMENT_BYTES + 1 });
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.message).toContain("25 MB");
  });
  it("matches the bucket's list in the migration", () => {
    const sql = readFileSync("supabase/migrations/20270507095000_documents_library.sql", "utf8");
    for (const m of DOCUMENT_MIME_TYPES) expect(sql).toContain(`'${m}'`);
    expect(DOCUMENT_MIME_TYPES).toHaveLength(11);
    expect(sql).toContain("26214400");
    expect(MAX_DOCUMENT_BYTES).toBe(26214400);
    expect(DOCUMENT_ACCEPT).toContain(".docx");
  });
  it("knows how to show a stored type", () => {
    expect(kindOfMime("image/png")).toBe("image");
    expect(kindOfMime("application/pdf")).toBe("pdf");
    expect(kindOfMime("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe(
      "sheet",
    );
  });
});

describe("safe storage names", () => {
  it("keeps letters, digits, dot, dash and underscore, and the extension", () => {
    expect(safeFileName("Meet Plan (final) v2.PDF")).toBe("Meet-Plan-final-v2.pdf");
    expect(safeFileName("Crème brûlée.docx")).toBe("Creme-brulee.docx");
    expect(safeFileName("../../etc/passwd.txt")).toBe("etc-passwd.txt");
    expect(safeFileName("....pdf")).toBe("document.pdf");
    expect(safeFileName("💪.png")).toBe("document.png");
  });
  it("never runs past 120 characters, extension included", () => {
    const n = safeFileName(`${"a".repeat(300)}.xlsx`);
    expect(n.length).toBeLessThanOrEqual(120);
    expect(n.endsWith(".xlsx")).toBe(true);
  });
  it("can take the extension from the type", () => {
    expect(safeFileName("scan", "jpg")).toBe("scan.jpg");
  });
  it("puts an upload in the uploader's own folder, in the shape the database checks", () => {
    const path = documentPath(ME, ID, "My plan.pdf");
    expect(path).toBe(`${ME}/${ID}-My-plan.pdf`);
    expect(isOwnDocumentPath(path, ME)).toBe(true);
    expect(isOwnDocumentPath(path, "00000000-0000-4000-8000-0000000000c1")).toBe(false);
    expect(isOwnDocumentPath(`${ME}/../x/${ID}-a.pdf`, ME)).toBe(false);
    expect(isOwnDocumentPath(`${ME}/${ID}-a..pdf`, ME)).toBe(false);
    expect(isOwnDocumentPath(`${ME}/sub/${ID}-a.pdf`, ME)).toBe(false);
    expect(isOwnDocumentPath(`${ME}/${ID}-a b.pdf`, ME)).toBe(false);
  });
  it("names a download after its title", () => {
    expect(
      downloadName({
        title: "Meet plan: week 1",
        mime: "application/pdf",
        file_path: `${ME}/${ID}-x.pdf`,
      }),
    ).toBe("Meet-plan-week-1.pdf");
  });
});

describe("titles and categories", () => {
  it("turns a file name into a title", () => {
    expect(titleFromFileName("meet-prep_plan.pdf")).toBe("meet prep plan");
    expect(titleFromFileName("Week 1 - Squat.xlsx")).toBe("Week 1 - Squat");
    expect(titleFromFileName(".pdf")).toBe("Document");
  });
  it("guesses a category from the name, only among what's offered", () => {
    expect(guessCategory("Meal plan Nov.pdf", "self")).toBe("nutrition_plan");
    expect(guessCategory("12_week_powerlifting_program.xlsx", "self")).toBe("training_program");
    expect(guessCategory("Overnight oats recipe.pdf", "self")).toBe("recipe");
    expect(guessCategory("Weekly check-in report.pdf", "self")).toBe("checkin_report");
    expect(guessCategory("Template.docx", "self")).toBe("other");
    expect(guessCategory("Template.docx", "staff")).toBe("template");
    expect(guessCategory("doctor note.jpg", "client")).toBe("client_document");
  });
  it("keeps the team's categories off a person's own library", () => {
    expect(categoriesFor("self").map((c) => c.value)).not.toContain("template");
    expect(categoriesFor("self").map((c) => c.value)).not.toContain("client_document");
    expect(categoriesFor("client").map((c) => c.value)).toContain("client_document");
    expect(categoriesFor("staff")).toHaveLength(7);
  });
});

describe("tags (the same cases as the SQL tests)", () => {
  it("trims, drops a leading #, dedupes ignoring capitals and keeps the first spelling", () => {
    expect(cleanTags([" Meet  prep ", "#meet prep", "Comp", "", "  ", "comp"])).toEqual([
      "Meet prep",
      "Comp",
    ]);
  });
  it("keeps at most 10, each at most 30 characters", () => {
    expect(cleanTags("abcdefghijkl".split(""))).toHaveLength(10);
    expect(cleanTags(["x".repeat(40)])).toEqual(["x".repeat(30)]);
    expect(cleanTags(null)).toEqual([]);
  });
  it("reads a box of tags split by commas", () => {
    expect(parseTagInput("peak, #Meet,meet , ")).toEqual(["peak", "Meet"]);
  });
});

describe("who can see it", () => {
  it("offers a coaching client their coach first, a member only themselves", () => {
    expect(visibilityOptions("self", { hasCoach: true }).map((o) => o.value)).toEqual([
      "coach",
      "private",
    ]);
    expect(visibilityOptions("self", { hasCoach: false }).map((o) => o.value)).toEqual(["private"]);
  });
  it("offers a coach coaches only first, then sharing with the client", () => {
    const o = visibilityOptions("client", { clientFirstName: "Marc" });
    expect(o.map((x) => x.value)).toEqual(["coach", "client", "private"]);
    expect(o[1].label).toBe("Shared with Marc");
  });
  it("keeps a staff member's own documents to them", () => {
    expect(visibilityOptions("staff").map((o) => o.value)).toEqual(["private"]);
  });
  it("says once, quietly, that nothing goes public", () => {
    expect(uploadPrivacyLine("coach", "self")).toBe(
      "Only you and your coach can see it. Uploading never makes anything public.",
    );
    expect(uploadPrivacyLine("client", "client", "Marc")).toBe(
      "Only Marc and their coach can see it. Uploading never makes anything public.",
    );
    expect(uploadPrivacyLine("private", "staff")).toBe(
      "Only you can see it. Uploading never makes anything public.",
    );
  });
  it("says where a document came from, or who else has it", () => {
    const coach = "00000000-0000-4000-8000-0000000000c1";
    expect(
      shareWords(doc({ owner_user_id: coach, visibility: "client" }), {
        userId: ME,
        scope: "self",
      }),
    ).toBe("From your coach");
    expect(shareWords(doc({ visibility: "coach" }), { userId: ME, scope: "self" })).toBe(
      "Shared with your coach",
    );
    expect(shareWords(doc({ visibility: "private" }), { userId: ME, scope: "self" })).toBeNull();
    expect(
      shareWords(doc({ owner_user_id: ME, visibility: "coach" }), {
        userId: coach,
        scope: "client",
        clientUserId: ME,
        clientFirstName: "Marc",
      }),
    ).toBe("From Marc");
    expect(
      shareWords(doc({ owner_user_id: coach, visibility: "client" }), {
        userId: coach,
        scope: "client",
        clientFirstName: "Marc",
      }),
    ).toBe("Shared with Marc");
    expect(
      shareWords(doc({ owner_user_id: coach, visibility: "coach" }), {
        userId: coach,
        scope: "client",
      }),
    ).toBe("Coaches only");
    expect(
      shareWords(doc({ owner_user_id: coach, visibility: "private" }), {
        userId: coach,
        scope: "client",
      }),
    ).toBe("Only you");
    expect(canEditDocument(doc({}), ME)).toBe(true);
    expect(canEditDocument(doc({ owner_user_id: coach }), ME)).toBe(false);
  });
});

describe("what a row says", () => {
  const now = new Date("2026-11-22T12:00:00");
  it("sizes", () => {
    expect(formatBytes(0)).toBe("0 KB");
    expect(formatBytes(12)).toBe("12 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1.25 * 1024 * 1024)).toBe("1.3 MB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3 MB");
    expect(formatBytes(24.6 * 1024 * 1024)).toBe("25 MB");
  });
  it("dates: no year this year", () => {
    expect(documentDate("2026-11-02T12:00:00", now)).toBe("Nov 2");
    expect(documentDate("2025-06-30T12:00:00", now)).toBe("Jun 30, 2025");
  });
  it("one meta line", () => {
    expect(
      metaLine(
        doc({
          category: "nutrition_plan",
          bytes: 1.25 * 1024 * 1024,
          created_at: "2026-11-02T12:00:00",
        }),
        now,
      ),
    ).toBe("Nutrition plan · 1.3 MB · Nov 2");
  });
  it("counts down Recently deleted", () => {
    expect(binLine("2026-11-22T11:00:00", now)).toBe("Deletes in 30 days");
    expect(binLine("2026-10-24T13:00:00", now)).toBe("Deletes tomorrow");
    expect(binLine("2026-10-01T12:00:00", now)).toBe("Deletes today");
  });
});

describe("search, filter, sort", () => {
  const docs = [
    doc({
      id: "a",
      title: "Meet plan week 10",
      category: "training_program",
      tags: ["Peak"],
      created_at: "2026-11-01T00:00:00Z",
    }),
    doc({
      id: "b",
      title: "meet plan week 2",
      category: "training_program",
      created_at: "2026-11-03T00:00:00Z",
    }),
    doc({ id: "c", title: "Crème brûlée", category: "recipe", created_at: "2026-11-02T00:00:00Z" }),
    doc({
      id: "d",
      title: "Macros",
      category: "nutrition_plan",
      tags: ["cut"],
      created_at: "2026-10-01T00:00:00Z",
    }),
  ];
  it("searches titles and tags, every word, ignoring capitals and accents", () => {
    expect(matchesSearch(docs[2], "creme")).toBe(true);
    expect(matchesSearch(docs[0], "plan peak")).toBe(true);
    expect(matchesSearch(docs[0], "#peak")).toBe(true);
    expect(matchesSearch(docs[1], "plan peak")).toBe(false);
    expect(filterDocuments(docs, { query: "cut" }).map((d) => d.id)).toEqual(["d"]);
  });
  it("filters by category", () => {
    expect(filterDocuments(docs, { category: "training_program" }).map((d) => d.id)).toEqual([
      "a",
      "b",
    ]);
    expect(filterDocuments(docs, { category: "all", query: "" })).toHaveLength(4);
  });
  it("sorts newest first, by name with numbers read as numbers, or by category", () => {
    expect(sortDocuments(docs, "newest").map((d) => d.id)).toEqual(["b", "c", "a", "d"]);
    expect(sortDocuments(docs, "name").map((d) => d.id)).toEqual(["c", "d", "b", "a"]);
    expect(sortDocuments(docs, "category").map((d) => d.id)).toEqual(["b", "a", "d", "c"]);
  });
  it("shows chips only for categories that hold something, plus the one picked", () => {
    expect(categoryChips(docs).map((c) => c.value)).toEqual([
      "training_program",
      "nutrition_plan",
      "recipe",
    ]);
    expect(categoryChips(docs, "template").map((c) => c.value)).toContain("template");
    expect(categoryChips(docs)[0].count).toBe(2);
  });
});
