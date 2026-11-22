/**
 * Documents (Nov 22 2026, 20270507095000_documents_library.sql): one private
 * library per person, for files they upload and originals other features file
 * for them. Pure, no React and no Supabase: categories and their words, which
 * files it takes, safe storage names, search, filters and sorting, and what a
 * row says. The database holds the same rules where they matter (the bucket's
 * types and size, the path inside the uploader's folder, cleanTags).
 */

export const DOCUMENTS_BUCKET = "documents";
/** The bucket's limit (26214400 bytes). */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
/** A deleted document waits this long in Recently deleted before it's gone for good. */
export const RECENTLY_DELETED_DAYS = 30;
export const MAX_TAGS = 10;
export const MAX_TAG_CHARS = 30;
export const MAX_TITLE_CHARS = 200;

/** What a person confirms before an upload, stored word for word on the row. */
export const RIGHTS_TEXT =
  "I created this or have the rights or permission to upload it and use it in JF Effect. Buying a program doesn't by itself give permission to share or resell it.";

export type DocumentCategory =
  | "training_program"
  | "nutrition_plan"
  | "recipe"
  | "checkin_report"
  | "client_document"
  | "template"
  | "other";

export const DOCUMENT_CATEGORIES: { value: DocumentCategory; label: string }[] = [
  { value: "training_program", label: "Training program" },
  { value: "nutrition_plan", label: "Nutrition plan" },
  { value: "recipe", label: "Recipe" },
  { value: "checkin_report", label: "Check-in report" },
  { value: "client_document", label: "Client document" },
  { value: "template", label: "Template" },
  { value: "other", label: "Other" },
];

export function isDocumentCategory(v: unknown): v is DocumentCategory {
  return DOCUMENT_CATEGORIES.some((c) => c.value === v);
}

export function categoryLabel(c: string): string {
  return DOCUMENT_CATEGORIES.find((x) => x.value === c)?.label ?? "Other";
}

/** Whose library it is: a person's own (member or client), a coach's for a client, a staff member's own. */
export type LibraryScope = "self" | "client" | "staff";

/** The categories offered when filing a document (a client document and a template are the team's). */
export function categoriesFor(scope: LibraryScope): { value: DocumentCategory; label: string }[] {
  if (scope === "self")
    return DOCUMENT_CATEGORIES.filter(
      (c) => c.value !== "client_document" && c.value !== "template",
    );
  if (scope === "client") return DOCUMENT_CATEGORIES.filter((c) => c.value !== "template");
  return DOCUMENT_CATEGORIES;
}

export type DocumentVisibility = "private" | "coach" | "client";
export type DocumentSource = "upload" | "import" | "export";

export interface DocumentRow {
  id: string;
  owner_user_id: string;
  client_id: string | null;
  category: DocumentCategory;
  title: string;
  tags: string[];
  file_path: string;
  mime: string;
  bytes: number;
  source: DocumentSource;
  linked_kind: string | null;
  linked_id: string | null;
  visibility: DocumentVisibility;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/* ───────────────────────── files ───────────────────────── */

export type FileKind = "pdf" | "image" | "word" | "sheet" | "csv" | "text";

/** Every type the bucket takes, by extension (what the phone says a file is can be empty or wrong). */
const TYPES: Record<string, { mime: string; kind: FileKind }> = {
  pdf: { mime: "application/pdf", kind: "pdf" },
  jpg: { mime: "image/jpeg", kind: "image" },
  jpeg: { mime: "image/jpeg", kind: "image" },
  png: { mime: "image/png", kind: "image" },
  webp: { mime: "image/webp", kind: "image" },
  heic: { mime: "image/heic", kind: "image" },
  heif: { mime: "image/heif", kind: "image" },
  gif: { mime: "image/gif", kind: "image" },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "word",
  },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    kind: "sheet",
  },
  csv: { mime: "text/csv", kind: "csv" },
  txt: { mime: "text/plain", kind: "text" },
};

/** The bucket's allowed types (the migration's list). */
export const DOCUMENT_MIME_TYPES = Array.from(new Set(Object.values(TYPES).map((t) => t.mime)));

/** For a file input: the extensions and the types. */
export const DOCUMENT_ACCEPT = [
  ...Object.keys(TYPES).map((e) => `.${e}`),
  ...DOCUMENT_MIME_TYPES,
].join(",");

/** What a file picker's mime type says, when the name has no extension we know. */
const BY_MIME: Record<string, string> = {};
for (const [ext, t] of Object.entries(TYPES)) BY_MIME[t.mime] ??= ext;

export function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

/** The type a file goes up as: by its extension first, else what the picker said. */
export function fileTypeOf(
  name: string,
  mime?: string | null,
): { ext: string; mime: string; kind: FileKind } | null {
  const ext = extensionOf(name);
  if (ext && TYPES[ext]) return { ext, ...TYPES[ext] };
  const base = (mime ?? "").split(";")[0].trim().toLowerCase();
  const fromMime = BY_MIME[base];
  return fromMime ? { ext: fromMime, ...TYPES[fromMime] } : null;
}

/** What a stored type is, for its icon and its preview. */
export function kindOfMime(mime: string): FileKind {
  const ext = BY_MIME[(mime ?? "").split(";")[0].trim().toLowerCase()];
  return ext ? TYPES[ext].kind : "text";
}

export type FileCheck =
  | { ok: true; ext: string; mime: string; kind: FileKind }
  | { ok: false; message: string };

/** Before anything uploads: a type the library takes, not empty, not over 25 MB. */
export function checkFile(file: { name: string; size: number; type?: string | null }): FileCheck {
  const t = fileTypeOf(file.name, file.type);
  if (!t)
    return {
      ok: false,
      message:
        "That kind of file can't go in your documents. Use a PDF, a photo, a Word or Excel file, a CSV or a text file.",
    };
  if (!file.size) return { ok: false, message: "That file is empty." };
  if (file.size > MAX_DOCUMENT_BYTES)
    return {
      ok: false,
      message: `That file is ${formatBytes(file.size)}. Documents can be up to 25 MB.`,
    };
  return { ok: true, ...t };
}

/**
 * A storage name that's safe anywhere: letters, digits, dot, dash and
 * underscore, never "..", at most 120 characters with its extension kept
 * (the database checks the same shape).
 */
export function safeFileName(name: string, ext?: string): string {
  const extension = (ext ?? extensionOf(name))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  const stem = (extensionOf(name) ? name.trim().replace(/\.[A-Za-z0-9]{1,8}$/, "") : name.trim())
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  const room = 120 - (extension ? extension.length + 1 : 0);
  const kept = (stem || "document").slice(0, room).replace(/[-.]+$/, "") || "document";
  return extension ? `${kept}.${extension}` : kept;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATH_RE = new RegExp(`^(${UUID})/${UUID}-[A-Za-z0-9._-]{1,120}$`);

/** Where an upload goes: the uploader's own folder, a fresh id, the safe name. */
export function documentPath(
  ownerUserId: string,
  id: string,
  fileName: string,
  ext?: string,
): string {
  return `${ownerUserId}/${id}-${safeFileName(fileName, ext)}`;
}

/** A path in this person's own folder, in the shape the database takes. */
export function isOwnDocumentPath(path: string, userId: string): boolean {
  const m = PATH_RE.exec(path);
  return !!m && m[1] === userId && !path.includes("..");
}

/** A file's name as a document's title: no extension, dashes and underscores as spaces. */
export function titleFromFileName(name: string): string {
  let stem = name.trim().replace(/\.[A-Za-z0-9]{1,8}$/, "");
  // "meet-prep_plan" reads as words; "Week 1 - Squat" keeps its dash
  stem = /\s/.test(stem) ? stem.replace(/_+/g, " ") : stem.replace(/[-_]+/g, " ");
  return cleanTitle(stem) || "Document";
}

export function cleanTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_CHARS);
}

/** The download's file name: the title, safe, with the file's own extension. */
export function downloadName(doc: Pick<DocumentRow, "title" | "mime" | "file_path">): string {
  const ext = extensionOf(doc.file_path) || BY_MIME[doc.mime] || "";
  return safeFileName(doc.title, ext);
}

/* ───────────────────────── tags ───────────────────────── */

/**
 * Trimmed, one space, no leading #, at most 30 characters, each once
 * (case-insensitive, the first spelling kept), at most 10. The database's
 * documents_clean_tags is the same rule.
 */
export function cleanTags(
  tags: readonly (string | null | undefined)[] | null | undefined,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags ?? []) {
    const t = (raw ?? "")
      .replace(/^\s*#+/, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_TAG_CHARS)
      .trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** Tags typed in one box: commas (or new lines) between them. */
export function parseTagInput(text: string): string[] {
  return cleanTags(text.split(/[,\n]/));
}

/* ───────────────────────── a guess at the category ───────────────────────── */

const GUESSES: [RegExp, DocumentCategory][] = [
  [/\brecipe|cookbook\b/i, "recipe"],
  [/\b(meal|nutrition|macro|macros|diet|calorie|calories|food|grocery)\b/i, "nutrition_plan"],
  [/\b(check[- ]?in|report|progress)\b/i, "checkin_report"],
  [
    /\b(program|programme|training|workout|workouts|block|peak|meet|prep|powerlifting|hypertrophy|strength|squat|bench|deadlift|split)\b/i,
    "training_program",
  ],
  [/\btemplate\b/i, "template"],
];

/** A first guess from the file's name, only among the categories this library offers. */
export function guessCategory(name: string, scope: LibraryScope): DocumentCategory {
  const words = name.replace(/[_.-]+/g, " ");
  const offered = new Set(categoriesFor(scope).map((c) => c.value));
  for (const [re, cat] of GUESSES) if (re.test(words) && offered.has(cat)) return cat;
  return scope === "client" ? "client_document" : "other";
}

/* ───────────────────────── who can see it ───────────────────────── */

export interface VisibilityOption {
  value: DocumentVisibility;
  label: string;
  hint: string;
}

/**
 * What the uploader can pick, the first being the default.
 *   self:   a coaching client: only them, or them and their coach (default);
 *           a member (no coach): only them.
 *   client: a coach for a client: coaches only (default), shared with the
 *           client, or only the coach.
 *   staff:  a staff member's own: only them.
 */
export function visibilityOptions(
  scope: LibraryScope,
  opts: { hasCoach?: boolean; clientFirstName?: string | null } = {},
): VisibilityOption[] {
  const first = (opts.clientFirstName ?? "").trim() || "them";
  if (scope === "self") {
    return opts.hasCoach
      ? [
          { value: "coach", label: "You and your coach", hint: "Your coach can open it too." },
          { value: "private", label: "Only you", hint: "Nobody else can open it." },
        ]
      : [{ value: "private", label: "Only you", hint: "Nobody else can open it." }];
  }
  if (scope === "client") {
    return [
      {
        value: "coach",
        label: "Coaches only",
        hint: `You and ${first}'s coach. ${first} doesn't see it.`,
      },
      {
        value: "client",
        label: `Shared with ${first}`,
        hint: `${first} can open it in their documents.`,
      },
      { value: "private", label: "Only you", hint: "Nobody else can open it." },
    ];
  }
  return [{ value: "private", label: "Only you", hint: "Nobody else can open it." }];
}

/** The one quiet line on the upload sheet. */
export function uploadPrivacyLine(
  visibility: DocumentVisibility,
  scope: LibraryScope,
  clientFirstName?: string | null,
): string {
  const first = (clientFirstName ?? "").trim() || "your client";
  const who =
    visibility === "private"
      ? "Only you can see it"
      : scope === "self"
        ? "Only you and your coach can see it"
        : visibility === "client"
          ? `Only ${first} and their coach can see it`
          : `Only ${first}'s coach can see it`;
  return `${who}. Uploading never makes anything public.`;
}

/**
 * Who else sees a document, in a few words for its row, or nothing when it's
 * only the viewer's. The viewer is the signed-in person; a document they
 * didn't upload says where it came from.
 */
export function shareWords(
  doc: Pick<DocumentRow, "owner_user_id" | "visibility" | "source">,
  viewer: {
    userId: string | null | undefined;
    scope: LibraryScope;
    clientUserId?: string | null;
    clientFirstName?: string | null;
  },
): string | null {
  const first = (viewer.clientFirstName ?? "").trim();
  const mine = !!viewer.userId && doc.owner_user_id === viewer.userId;
  if (!mine) {
    if (viewer.scope === "self") return "From your coach";
    if (viewer.clientUserId && doc.owner_user_id === viewer.clientUserId)
      return first ? `From ${first}` : "From the client";
    return "From the team";
  }
  // in a coach's view of a client, the coach's own private ones are said apart from the shared ones
  if (doc.visibility === "private") return viewer.scope === "client" ? "Only you" : null;
  if (viewer.scope === "self") return "Shared with your coach";
  if (doc.visibility === "client") return first ? `Shared with ${first}` : "Shared with the client";
  return "Coaches only";
}

/** May the viewer change it (rename, re-share, delete)? Only who filed it. */
export function canEditDocument(
  doc: Pick<DocumentRow, "owner_user_id">,
  userId: string | null | undefined,
): boolean {
  return !!userId && doc.owner_user_id === userId;
}

/* ───────────────────────── what a row says ───────────────────────── */

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 KB";
  if (n < 1024) return `${Math.max(1, Math.round(n))} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  const mb = n / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1).replace(/\.0$/, "") : Math.round(mb)} MB`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 22" this year, "Nov 22, 2025" before (the person's own clock). */
export function documentDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? day : `${day}, ${d.getFullYear()}`;
}

/** The row's one meta line: category · size · date. */
export function metaLine(
  doc: Pick<DocumentRow, "category" | "bytes" | "created_at">,
  now: Date = new Date(),
): string {
  return [categoryLabel(doc.category), formatBytes(doc.bytes), documentDate(doc.created_at, now)]
    .filter(Boolean)
    .join(" · ");
}

/** "Deletes in 12 days" for Recently deleted. */
export function binLine(deletedAt: string, now: Date = new Date()): string {
  const left = daysLeftInBin(deletedAt, now);
  if (left <= 0) return "Deletes today";
  return left === 1 ? "Deletes tomorrow" : `Deletes in ${left} days`;
}

/** Calendar days (the person's own) until a deleted document goes for good. */
export function daysLeftInBin(deletedAt: string, now: Date = new Date()): number {
  const end = new Date(new Date(deletedAt).getTime() + RECENTLY_DELETED_DAYS * 86_400_000);
  const a = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((a - b) / 86_400_000));
}

/* ───────────────────────── search, filter, sort ───────────────────────── */

export type DocumentSort = "newest" | "name" | "category";
export const DOCUMENT_SORTS: { value: DocumentSort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "name", label: "Name" },
  { value: "category", label: "Category" },
];

function fold(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Every word typed is in the title or a tag (capitals and accents don't matter). */
export function matchesSearch(doc: Pick<DocumentRow, "title" | "tags">, query: string): boolean {
  const words = fold(query)
    .split(/\s+/)
    .map((w) => w.replace(/^#/, ""))
    .filter(Boolean);
  if (!words.length) return true;
  const hay = fold([doc.title, ...(doc.tags ?? [])].join(" "));
  return words.every((w) => hay.includes(w));
}

export function filterDocuments<T extends Pick<DocumentRow, "title" | "tags" | "category">>(
  docs: readonly T[],
  opts: { category?: DocumentCategory | "all" | null; query?: string | null },
): T[] {
  return docs.filter(
    (d) =>
      (!opts.category || opts.category === "all" || d.category === opts.category) &&
      matchesSearch(d, opts.query ?? ""),
  );
}

const CATEGORY_ORDER = new Map(DOCUMENT_CATEGORIES.map((c, i) => [c.value, i]));
const collator =
  typeof Intl !== "undefined"
    ? new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
    : null;
const byName = (a: string, b: string) => (collator ? collator.compare(a, b) : a.localeCompare(b));
const newestFirst = (a: Pick<DocumentRow, "created_at">, b: Pick<DocumentRow, "created_at">) =>
  new Date(b.created_at).getTime() - new Date(a.created_at).getTime();

export function sortDocuments<T extends Pick<DocumentRow, "title" | "category" | "created_at">>(
  docs: readonly T[],
  sort: DocumentSort,
): T[] {
  const out = [...docs];
  if (sort === "name") out.sort((a, b) => byName(a.title, b.title) || newestFirst(a, b));
  else if (sort === "category")
    out.sort(
      (a, b) =>
        (CATEGORY_ORDER.get(a.category) ?? 99) - (CATEGORY_ORDER.get(b.category) ?? 99) ||
        newestFirst(a, b),
    );
  else out.sort(newestFirst);
  return out;
}

/** The category chips: only categories that hold something (plus the one picked), in the usual order. */
export function categoryChips(
  docs: readonly Pick<DocumentRow, "category">[],
  picked?: DocumentCategory | "all" | null,
): { value: DocumentCategory; label: string; count: number }[] {
  const counts = new Map<DocumentCategory, number>();
  for (const d of docs) counts.set(d.category, (counts.get(d.category) ?? 0) + 1);
  return DOCUMENT_CATEGORIES.filter((c) => counts.has(c.value) || c.value === picked).map((c) => ({
    ...c,
    count: counts.get(c.value) ?? 0,
  }));
}

export function isDocumentSort(v: unknown): v is DocumentSort {
  return v === "newest" || v === "name" || v === "category";
}
